#!/usr/bin/env python3
"""
把「双手举横幅跳跃」的 sprite sheet 处理成带「恭喜发财」红字的桌宠帧池。

为什么分两步：AI 直接画中文几乎必然写错字，所以让 AI 只画**空白横幅**，
中文用系统中文字体（msyhbd）在脚本里绘制 —— 字一定对、颜色一定准。

布局原则（与 idle 帧对齐，切换动作不跳变）：
  - 角色本体缩放到与 idle 相同的角色高（274px），底部对齐；
  - 横幅单独缩放（宽 232 / 高 62）贴在头顶，底边与爪子重叠 6px 形成"握着"的观感；
  - 画布 271 宽，高度 = 6 + 274 + 62，宽度按 display.width 映射到 140px 显示。

用法：
    python scripts/make_banner_frames.py <sheet.png> [--action happy] [--text 恭喜发财]
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_action_frames import CANVAS_W, SKIN, cutout_white, idle_target_height  # noqa: E402
from sprite_sheet_to_frames import components, group_grid  # noqa: E402

FONT = r'C:\Windows\Fonts\msyhbd.ttc'
TEXT_COLOR = (200, 22, 29)     # 朱红
BANNER_W, BANNER_H = 232, 62
GRIP_OVERLAP = 6               # 横幅底边压在爪子上方的像素数
TOP_PAD = 6


def detect_banner(crop: Image.Image):
    """用横幅的金色描边定位横幅范围（比找奶油色布料更稳，不会把熊猫白毛算进去）。"""
    px = crop.load()
    w, h = crop.size
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 200 and 165 <= r <= 235 and 140 <= g <= 200 and 70 <= b <= 150 \
                    and (r - b) >= 55 and (g - b) >= 30:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None
    return (min(xs), min(ys), max(xs) + 1, max(ys) + 1)


def draw_text_on_banner(banner: Image.Image, text: str) -> Image.Image:
    """在横幅布料上居中写红字，字号自适应到可用宽度。"""
    im = banner.copy()
    d = ImageDraw.Draw(im)
    w, h = im.size
    inset_x = int(w * 0.12)
    inset_y = int(h * 0.16)
    avail_w = w - inset_x * 2
    avail_h = h - inset_y * 2
    size = avail_h
    while size > 6:
        font = ImageFont.truetype(FONT, size)
        bbox = d.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if tw <= avail_w and th <= avail_h:
            break
        size -= 1
    font = ImageFont.truetype(FONT, size)
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (w - tw) / 2 - bbox[0]
    y = (h - th) / 2 - bbox[1]
    d.text((x, y), text, font=font, fill=TEXT_COLOR)
    return im


def build_frame(crop: Image.Image, text: str, body_h: int) -> Image.Image:
    banner_box = detect_banner(crop)
    if banner_box is None:
        raise SystemExit('没找到横幅（金色描边），检查 AI 出图是否带金色边框')
    bx0, by0, bx1, by1 = banner_box
    # 横幅单独取（含金色边框）；本体从横幅底边略上方开始，保证爪子与横幅相接
    banner = crop.crop((bx0, by0, bx1, by1))
    body = crop.crop((0, max(0, by1 - GRIP_OVERLAP - 2), crop.width, crop.height))
    bb = body.getchannel('A').getbbox()
    if not bb:
        raise SystemExit('本体裁剪后为空')
    body = body.crop(bb)

    # 本体：高度对齐 idle，宽度不超过画布（留 8px 余量）
    scale = body_h / body.height
    if body.width * scale > CANVAS_W - 8:
        scale = (CANVAS_W - 8) / body.width
    bw = max(1, round(body.width * scale))
    bh = max(1, round(body.height * scale))
    body = body.resize((bw, bh), Image.LANCZOS)

    banner = banner.resize((BANNER_W, BANNER_H), Image.LANCZOS)
    banner = draw_text_on_banner(banner, text)

    canvas_h = TOP_PAD + BANNER_H + bh
    canvas = Image.new('RGBA', (CANVAS_W, canvas_h), (0, 0, 0, 0))
    banner_x = (CANVAS_W - BANNER_W) // 2
    banner_y = TOP_PAD
    canvas.paste(banner, (banner_x, banner_y), banner)
    # 本体压在横幅下沿之上（后贴 -> 爪子在横幅前，形成"握住"的层次）
    body_x = (CANVAS_W - bw) // 2
    body_y = canvas_h - bh
    canvas.paste(body, (body_x, body_y), body)
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('sheet')
    ap.add_argument('--action', default='happy')
    ap.add_argument('--text', default='恭喜发财')
    args = ap.parse_args()

    sheet = cutout_white(Image.open(args.sheet))
    cells = group_grid(components(sheet), sheet.size, 2, 2)
    body_h = idle_target_height()
    out_dir = os.path.join(SKIN, 'actions', args.action)
    os.makedirs(out_dir, exist_ok=True)
    for old in os.listdir(out_dir):
        if old.endswith('.png'):
            os.remove(os.path.join(out_dir, old))

    for i, box in enumerate(cells, start=1):
        crop = sheet.crop((box[0], box[1], box[2] + 1, box[3] + 1))
        frame = build_frame(crop, args.text, body_h)
        frame.save(os.path.join(out_dir, f'{i:04d}.png'), optimize=True)
        print(f'  帧 {i}: {frame.size}')
    print(f'[OK] {args.action}: {len(cells)} 帧，红字「{args.text}」，本体高 {body_h}px -> {out_dir}')


if __name__ == '__main__':
    main()
