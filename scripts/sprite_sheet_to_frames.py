#!/usr/bin/env python3
"""
把 AI 生成的「sprite sheet（多格动作序列图）」切成皮肤帧池。

与 make_action_frames.py 的区别：那个脚本处理的是「一张图 = 一帧」，
本脚本处理「一张图 = N 帧」（例如 2x2 的四帧走路循环），需要先切分。

用法：
    python scripts/sprite_sheet_to_frames.py <sheet.png> <动作名> [--fps 9] [--order rowmajor|diagonal]

切分方式：抠白底 → 在 alpha 通道做 4/8 连通域标记 → 取面积最大的 N 个连通域
（同一格里的帽子绒球若与身体断开，会自动并入最近的格子）→ 按从上到下、
从左到右排序 → 逐帧走统一的「等比缩放到 idle 角色高度、底部对齐、水平居中」。

输出：resources/skins/panda-shake-v4/actions/<动作名>/0001..000N.png（271x280 RGBA）
"""
import argparse
import collections
import glob
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_action_frames import (  # noqa: E402  复用同一套抠图/对齐口径
    BOTTOM, CANVAS_H, CANVAS_W, SKIN, cutout_white, idle_target_height,
)

MIN_AREA = 2000       # 小于该像素数的连通域视为噪点
MERGE_GAP = 90        # 与主连通域中心距离小于该值的碎片并入同一格


def components(rgba: Image.Image):
    """4 连通域标记，返回 [(面积, (x0,y0,x1,y1))]，按面积降序。"""
    a = rgba.getchannel('A')
    w, h = a.size
    px = a.load()
    seen = bytearray(w * h)
    out = []
    for y in range(h):
        for x in range(w):
            idx = y * w + x
            if px[x, y] <= 10 or seen[idx]:
                continue
            q = collections.deque([(x, y)])
            seen[idx] = 1
            x0 = x1 = x
            y0 = y1 = y
            n = 0
            while q:
                cx, cy = q.popleft()
                n += 1
                if cx < x0: x0 = cx
                if cx > x1: x1 = cx
                if cy < y0: y0 = cy
                if cy > y1: y1 = cy
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        ni = ny * w + nx
                        if not seen[ni] and px[nx, ny] > 10:
                            seen[ni] = 1
                            q.append((nx, ny))
            if n >= MIN_AREA:
                out.append((n, (x0, y0, x1, y1)))
    out.sort(key=lambda t: -t[0])
    return out


def group_grid(comps, size, cols=2, rows=2):
    """把连通域按中心点归到 cols x rows 网格，返回每格合并后的包围盒（行优先）。"""
    w_img, h_img = size
    cells = {}
    for _area, bbox in comps:
        cx = (bbox[0] + bbox[2]) / 2
        cy = (bbox[1] + bbox[3]) / 2
        gx = min(cols - 1, max(0, int(cx / (w_img / cols))))
        gy = min(rows - 1, max(0, int(cy / (h_img / rows))))
        key = (gy, gx)
        b = cells.get(key)
        if b:
            cells[key] = (min(b[0], bbox[0]), min(b[1], bbox[1]),
                          max(b[2], bbox[2]), max(b[3], bbox[3]))
        else:
            cells[key] = bbox
    return [cells[k] for k in sorted(cells)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet')
    ap.add_argument('action')
    ap.add_argument('--cols', type=int, default=2)
    ap.add_argument('--rows', type=int, default=2)
    args = ap.parse_args()

    if not os.path.exists(args.sheet):
        sys.exit(f'找不到 {args.sheet}')
    rgba = cutout_white(Image.open(args.sheet))
    comps = components(rgba)
    if not comps:
        sys.exit('抠图后没有任何前景，检查背景是否为白底')

    cells = group_grid(comps, rgba.size, args.cols, args.rows)
    print(f'连通域 {len(comps)} 个 -> 网格 {args.cols}x{args.rows}，得到 {len(cells)} 格')

    target_h = idle_target_height()
    out_dir = os.path.join(SKIN, 'actions', args.action)
    os.makedirs(out_dir, exist_ok=True)
    for old in glob.glob(os.path.join(out_dir, '*.png')):
        os.remove(old)

    pad = 2
    made = 0
    for i, (x0, y0, x1, y1) in enumerate(cells, start=1):
        crop = rgba.crop((max(0, x0 - pad), max(0, y0 - pad),
                          min(rgba.width, x1 + pad + 1), min(rgba.height, y1 + pad + 1)))
        bbox = crop.getchannel('A').getbbox()
        if not bbox:
            print(f'  [警告] 第 {i} 格全透明，跳过')
            continue
        crop = crop.crop(bbox)
        scale = target_h / crop.height
        nw = max(1, round(crop.width * scale))
        crop = crop.resize((nw, target_h), Image.LANCZOS)
        canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
        canvas.paste(crop, ((CANVAS_W - nw) // 2, CANVAS_H - BOTTOM - target_h), crop)
        canvas.save(os.path.join(out_dir, f'{i:04d}.png'), optimize=True)
        made += 1
    print(f'[OK] {args.action}: {made} 帧 -> {out_dir}（角色高 {target_h}px）')


if __name__ == '__main__':
    main()
