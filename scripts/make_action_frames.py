#!/usr/bin/env python3
"""
把 AI 生成的白底动作图处理成桌宠皮肤帧池，并与现有 idle 帧对齐。

用法：
    python scripts/make_action_frames.py

输入（generated-images/）：
    jump/*.png   跳跃动作帧
    cry/*.png    哭泣动作帧

输出（resources/skins/panda-shake-v4/actions/）：
    happy/0001..0004.png   独立帧池
    sad/0001..0004.png     独立帧池

处理要点：
  1. 抠白底：从四边 floodfill 连通的近白区域为透明；熊猫身体内部浅色不连通，保留。
  2. 裁剪到 alpha 联合包围盒（与 gif_to_skin.py 同口径）。
  3. 缩放使角色高度 ≈ idle 帧角色高度，底部对齐（距底边 3px）、水平居中，画布 271x280。
  4. 输出到 271x280 RGBA，与 idle 帧画布一致，切换动作不跳变。
"""
import glob
import os
from collections import deque
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..')
SKIN = os.path.join(ROOT, 'resources', 'skins', 'panda-shake-v4')
IDLE_DIR = os.path.join(SKIN, 'actions', 'idle')
CANVAS_W, CANVAS_H = 271, 280
BOTTOM = 3          # 角色脚底到画布底边距离（与 idle 帧一致）
WHITE_TH = 244      # 近白阈值：>= 该值视为候选背景


def cutout_white(im: Image.Image) -> Image.Image:
    """从四边 floodfill 连通的近白区域 -> 透明；返回 RGBA。"""
    rgba = im.convert('RGBA')
    w, h = rgba.size
    px = rgba.load()
    # visited 标记（只处理近白像素）
    visited = bytearray(w * h)
    q = deque()
    # 四个角/边缘种子：所有边缘上的近白像素入队
    for x in range(w):
        for y in (0, h - 1):
            r, g, b, a = px[x, y]
            if r >= WHITE_TH and g >= WHITE_TH and b >= WHITE_TH:
                idx = y * w + x
                if not visited[idx]:
                    visited[idx] = 1
                    q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            r, g, b, a = px[x, y]
            if r >= WHITE_TH and g >= WHITE_TH and b >= WHITE_TH:
                idx = y * w + x
                if not visited[idx]:
                    visited[idx] = 1
                    q.append((x, y))
    # BFS 扩散
    while q:
        x, y = q.popleft()
        px[x, y] = (255, 255, 255, 0)
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h:
                idx = ny * w + nx
                if not visited[idx]:
                    r, g, b, a = px[nx, ny]
                    if r >= WHITE_TH and g >= WHITE_TH and b >= WHITE_TH:
                        visited[idx] = 1
                        q.append((nx, ny))
    return rgba


def idle_target_height():
    """现有 idle 帧角色的典型高度（取联合包围盒高度）。"""
    union = None
    for f in sorted(glob.glob(os.path.join(IDLE_DIR, '*.png'))):
        im = Image.open(f).convert('RGBA')
        bbox = im.getchannel('A').getbbox()
        if not bbox:
            continue
        if union is None:
            union = list(bbox)
        else:
            union[0] = min(union[0], bbox[0]); union[1] = min(union[1], bbox[1])
            union[2] = max(union[2], bbox[2]); union[3] = max(union[3], bbox[3])
    return union[3] - union[1]


def process_group(pattern: str, out_name: str, target_h: int):
    files = sorted(glob.glob(pattern))
    if not files:
        print(f'[跳过] {out_name}: 没找到 {pattern}')
        return
    out_dir = os.path.join(SKIN, 'actions', out_name)
    os.makedirs(out_dir, exist_ok=True)
    # 先全部抠图 + 裁包围盒
    cut = []
    for f in files:
        rgba = cutout_white(Image.open(f))
        bbox = rgba.getchannel('A').getbbox()
        if not bbox:
            print(f'  [警告] {os.path.basename(f)} 抠图后全透明，跳过')
            continue
        cut.append(rgba.crop(bbox))
    if not cut:
        return
    # 统一高度：按 target_h 缩放（保持宽高比），画布底部对齐、水平居中
    for i, im in enumerate(cut, start=1):
        scale = target_h / im.height
        nw = max(1, round(im.width * scale))
        im = im.resize((nw, target_h), Image.LANCZOS)
        canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
        x = (CANVAS_W - nw) // 2
        y = CANVAS_H - BOTTOM - target_h
        canvas.paste(im, (x, y), im)
        canvas.save(os.path.join(out_dir, f'{i:04d}.png'), optimize=True)
    print(f'[OK] {out_name}: {len(cut)} 帧 -> {out_dir}')


def main():
    th = idle_target_height()
    print(f'idle 角色目标高度 = {th}px, 画布 {CANVAS_W}x{CANVAS_H}, bottom={BOTTOM}')
    process_group(os.path.join(ROOT, 'generated-images', 'jump', '*.png'), 'happy', th)
    process_group(os.path.join(ROOT, 'generated-images', 'cry', '*.png'), 'sad', th)


if __name__ == '__main__':
    main()
