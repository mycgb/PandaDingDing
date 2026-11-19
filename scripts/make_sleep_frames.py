#!/usr/bin/env python3
"""
把「躺着睡觉呼吸循环」的 sprite sheet 处理成 sleepy 帧池（含 Zzz 符号）。

用法：
    python scripts/make_sleep_frames.py <sheet.png> [--action sleepy]

处理要点：
  1. 切格（复用 sprite_sheet_to_frames 的连通域分组）；
  2. 抠白底 → 按统一宽度缩放（躺姿很宽，按宽度对齐才不会被裁），底部对齐 271x280；
  3. 头顶画 3 个渐大的 Z（拉丁字母，用系统字体，避免 AI 写坏）；
     位置相对每个角色包围盒的右上角，四帧一致，呼吸本身提供动感。
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_action_frames import BOTTOM, CANVAS_H, CANVAS_W, SKIN, cutout_white  # noqa: E402
from sprite_sheet_to_frames import components, group_grid  # noqa: E402

FONT = r'C:\Windows\Fonts\msyhbd.ttc'
Z_COLOR = (140, 160, 184, 210)
TARGET_W = 250          # 角色统一宽度（留出左右边距）
Z_SIZES = (15, 20, 26)  # 三个 Z 由小到大


def draw_zzz(canvas: Image.Image, top: int, right: int) -> None:
    """在角色右上角叠三个渐大的 Z，象征打呼。"""
    d = ImageDraw.Draw(canvas)
    x, y = right - 6, top - 46
    for i, size in enumerate(Z_SIZES):
        font = ImageFont.truetype(FONT, size)
        bbox = d.textbbox((0, 0), 'Z', font=font)
        d.text((x - (bbox[2] - bbox[0]), y - (bbox[3] - bbox[1])), 'Z', font=font, fill=Z_COLOR)
        x -= size * 0.55
        y -= size * 0.95


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet')
    ap.add_argument('--action', default='sleepy')
    args = ap.parse_args()

    sheet = cutout_white(Image.open(args.sheet))
    cells = group_grid(components(sheet), sheet.size, 2, 2)
    out_dir = os.path.join(SKIN, 'actions', args.action)
    os.makedirs(out_dir, exist_ok=True)
    for old in os.listdir(out_dir):
        if old.endswith('.png'):
            os.remove(os.path.join(out_dir, old))

    for i, box in enumerate(cells, start=1):
        crop = sheet.crop((box[0], box[1], box[2] + 1, box[3] + 1))
        bbox = crop.getchannel('A').getbbox()
        if not bbox:
            print(f'  [警告] 第 {i} 格全透明，跳过')
            continue
        crop = crop.crop(bbox)
        scale = TARGET_W / crop.width
        nw, nh = TARGET_W, max(1, round(crop.height * scale))
        if nh > CANVAS_H - BOTTOM - 30:      # 高度兜底，给 Zzz 留空间
            nh = CANVAS_H - BOTTOM - 30
            nw = max(1, round(crop.width * nh / crop.height))
        crop = crop.resize((nw, nh), Image.LANCZOS)

        canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
        x = (CANVAS_W - nw) // 2
        y = CANVAS_H - BOTTOM - nh
        canvas.paste(crop, (x, y), crop)
        draw_zzz(canvas, top=y, right=x + nw)
        canvas.save(os.path.join(out_dir, f'{i:04d}.png'), optimize=True)
        print(f'  帧 {i}: 角色 {nw}x{nh} @ ({x},{y})')

    print(f'[OK] {args.action}: {len(cells)} 帧 -> {out_dir}')


if __name__ == '__main__':
    main()
