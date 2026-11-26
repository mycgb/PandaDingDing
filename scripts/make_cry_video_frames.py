#!/usr/bin/env python3
"""
把 AI 图生视频抽出的哭熊猫帧，处理成桌宠皮肤 cry 帧池。

与 make_action_frames.py 的区别：
  - 视频帧必须用「所有帧联合包围盒 + 统一缩放」，不能用每帧各自包围盒，
    否则帧间角色尺寸/位置会跳（视频里的呼吸起伏要保留，但标尺要固定）。
  - 输入近白背景（视频压缩有噪点），floodfill 从四边抠近白连通区。

用法：
    python scripts/make_cry_video_frames.py [frames_dir] [out_name]
默认输入 generated-videos/cry/frames_hi，输出 resources/skins/panda-shake-v4/actions/cry
"""
import glob
import os
import sys
from collections import deque

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..')
SKIN = os.path.join(ROOT, 'resources', 'skins', 'panda-shake-v4')
IDLE_DIR = os.path.join(SKIN, 'actions', 'idle')
CANVAS_W, CANVAS_H = 271, 280
BOTTOM = 3
WHITE_TH = 240          # 视频近白底（含压缩噪点）阈值


def cutout_white(im):
    rgba = im.convert('RGBA')
    w, h = rgba.size
    px = rgba.load()
    visited = bytearray(w * h)
    q = deque()
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


def main():
    frames_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'generated-videos', 'cry', 'frames_hi')
    out_name = sys.argv[2] if len(sys.argv) > 2 else 'cry'
    files = sorted(glob.glob(os.path.join(frames_dir, 'raw_*.png')))
    if not files:
        print('[错误] 没找到帧:', frames_dir)
        return
    files = files[:16]
    target_h = idle_target_height()
    print(f'输入 {len(files)} 帧, idle目标高度={target_h}px, 画布={CANVAS_W}x{CANVAS_H}')

    # 1) 全部抠图，同时算联合包围盒（在原尺寸坐标系上，保证帧间标尺统一）
    raw_cut = []
    union = None
    for f in files:
        rgba = cutout_white(Image.open(f))
        bbox = rgba.getchannel('A').getbbox()
        if not bbox:
            continue
        raw_cut.append((rgba, bbox))
        if union is None:
            union = list(bbox)
        else:
            union[0] = min(union[0], bbox[0]); union[1] = min(union[1], bbox[1])
            union[2] = max(union[2], bbox[2]); union[3] = max(union[3], bbox[3])
    print('联合包围盒:', union, '尺寸:', (union[2] - union[0], union[3] - union[1]))

    # 3) 用联合框裁所有帧 -> 统一缩放到底部对齐
    out_dir = os.path.join(SKIN, 'actions', out_name)
    os.makedirs(out_dir, exist_ok=True)
    # 清掉旧帧
    for old in glob.glob(os.path.join(out_dir, '*.png')):
        os.remove(old)
    scale = target_h / (union[3] - union[1])
    crop_w = union[2] - union[0]
    nw = max(1, round(crop_w * scale))
    for i, (rgba, _) in enumerate(raw_cut, start=1):
        region = rgba.crop(tuple(union))
        region = region.resize((nw, target_h), Image.LANCZOS)
        canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
        x = (CANVAS_W - nw) // 2
        y = CANVAS_H - BOTTOM - target_h
        canvas.paste(region, (x, y), region)
        canvas.save(os.path.join(out_dir, f'{i:04d}.png'), optimize=True)
    print(f'[OK] {out_name}: {len(raw_cut)} 帧 -> {out_dir}')

    # 4) 拼一张预览图便于检查
    sheet = Image.new('RGB', (4 * 271, 4 * 280), (235, 235, 235))
    d = ImageDraw.Draw(sheet)
    for i in range(len(raw_cut)):
        im = Image.open(os.path.join(out_dir, f'{i+1:04d}.png')).convert('RGBA')
        cx = (i % 4) * 271; cy = (i // 4) * 280
        sheet.paste(im, (cx, cy), im)
        d.text((cx + 4, cy + 4), str(i + 1), fill=(255, 0, 0))
    preview = os.path.join(ROOT, '.workbuddy', f'{out_name}-frames-preview.png')
    sheet.save(preview)
    print('预览:', preview)


if __name__ == '__main__':
    main()
