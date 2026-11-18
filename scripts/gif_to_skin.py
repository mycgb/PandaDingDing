#!/usr/bin/env python3
"""
把 GIF 动画转换成 PandaDingDing（熊猫盯盯）皮肤包。

用法：
    python scripts/gif_to_skin.py <input.gif> <skin-name> [--long-side 280]

产物：
    resources/skins/<skin-name>/actions/idle/0001.png ... NNNN.png   （唯一种子帧池）
    resources/skins/<skin-name>/manifest.json
    resources/skins/<skin-name>/tray.png                              （托盘图标）

manifest 动作映射策略：
    idle / idle-smile / idle-frown  完整循环，仅播放速度不同（情绪由速度表达）
    happy / sad                     完整循环，更快 / 更慢
    panic-*                         取「站立招手」高潮段，高速循环
    sleep / offline                 静止单帧
    walk                            完整循环（漫游功能尚未启用，占位）

关键点：所有帧按「全片 alpha 联合包围盒」裁剪，避免角色在画面内位移造成抖动；
     其余动作通过 manifest 的 from/start 复用 idle 帧池，不重复占磁盘与内存。
"""
import argparse
import json
import os
import shutil
from PIL import Image

MARGIN = 10  # 包围盒外扩像素，避免裁到边缘


def load_frames(path: str):
    im = Image.open(path)
    n = getattr(im, 'n_frames', 1)
    frames = []
    durations = []
    for i in range(n):
        im.seek(i)
        frames.append(im.convert('RGBA'))
        durations.append(im.info.get('duration') or 80)
    return frames, durations


def union_bbox(frames):
    """全片 alpha 联合包围盒（固定裁剪框，保证各帧角色相对位置一致）"""
    box = None
    for f in frames:
        bbox = f.getchannel('A').getbbox()
        if bbox is None:
            continue
        if box is None:
            box = list(bbox)
        else:
            box[0] = min(box[0], bbox[0])
            box[1] = min(box[1], bbox[1])
            box[2] = max(box[2], bbox[2])
            box[3] = max(box[3], bbox[3])
    if box is None:
        raise SystemExit('GIF 全帧透明，无法提取角色')
    return box


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('gif')
    ap.add_argument('skin')
    ap.add_argument('--long-side', type=int, default=280)
    ap.add_argument('--root', default=os.path.join(os.path.dirname(__file__), '..'))
    args = ap.parse_args()

    frames, durations = load_frames(args.gif)
    n = len(frames)
    src_w, src_h = frames[0].size
    print(f'读取 {n} 帧，源尺寸 {src_w}x{src_h}，平均帧时长 {sum(durations)/n:.0f}ms')

    box = union_bbox(frames)
    print(f'联合 alpha 包围盒: {box}')
    pad = MARGIN
    box = [
        max(0, box[0] - pad),
        max(0, box[1] - pad),
        min(src_w, box[2] + pad),
        min(src_h, box[3] + pad),
    ]
    crop_w, crop_h = box[2] - box[0], box[3] - box[1]
    scale = args.long_side / max(crop_w, crop_h)
    out_w, out_h = max(1, round(crop_w * scale)), max(1, round(crop_h * scale))
    print(f'裁剪 {crop_w}x{crop_h} → 缩放 {out_w}x{out_h} (long_side={args.long_side})')
    # display.bottom：角色脚底到 PNG 底边的距离（缩放后）。
    # 因为已按 alpha 包围盒裁剪并外扩 pad，脚底（包围盒下边）距底边正好是 pad * scale。
    bottom_px = round(pad * scale)

    skin_dir = os.path.join(args.root, 'resources', 'skins', args.skin)
    idle_dir = os.path.join(skin_dir, 'actions', 'idle')
    if os.path.isdir(skin_dir):
        shutil.rmtree(skin_dir)
    os.makedirs(idle_dir, exist_ok=True)

    for i, f in enumerate(frames, start=1):
        cropped = f.crop(tuple(box)).resize((out_w, out_h), Image.LANCZOS)
        cropped.save(os.path.join(idle_dir, f'{i:04d}.png'), optimize=True)

    # 托盘图标：取第一帧头部区域（角色通常在上 1/3），缩放为方形
    head = frames[0].crop((box[0], box[1], box[2], box[1] + (box[3] - box[1]) // 2))
    tw = max(head.width, head.height)
    square = Image.new('RGBA', (tw, tw), (0, 0, 0, 0))
    square.paste(head, ((tw - head.width) // 2, 0))
    square.resize((64, 64), Image.LANCZOS).save(os.path.join(skin_dir, 'tray.png'), optimize=True)

    # 站立/招手高潮段起点：按经验取 1/3 处（站起动作通常在此完成）
    stand_start = max(1, n // 3)
    stand_len = n - stand_start + 1

    fps = round(1000 / (sum(durations) / n))
    # 全部动作统一复用 idle 帧池：GIF 只有一条连续动画，情绪用播放速度表达
    idle_ref = {'from': 'idle'}
    manifest = {
        'name': '熊猫 mycgb',
        'fps': fps,
        'anchor': [0.5, 1.0],
        'display': {'width': out_w, 'bottom': bottom_px},
        'actions': {
            'idle':        {'frames': n, 'loop': True, 'next': None},
            'idle-smile':  {'frames': n, 'loop': True, 'fps': fps + 3, **idle_ref},
            'idle-frown':  {'frames': n, 'loop': True, 'fps': max(4, fps - 5), **idle_ref},
            'happy':       {'frames': n, 'loop': True, 'fps': fps + 6, **idle_ref},
            'sad':         {'frames': n, 'loop': True, 'fps': max(4, fps - 6), **idle_ref},
            'panic-happy': {'frames': stand_len, 'loop': True, 'fps': 26, 'start': stand_start, **idle_ref},
            'panic-sad':   {'frames': stand_len, 'loop': True, 'fps': 26, 'start': stand_start, **idle_ref},
            'sleep':       {'frames': 1, 'loop': False, 'start': 2, **idle_ref},
            'offline':     {'frames': 1, 'loop': False, 'start': 2, **idle_ref},
            'walk':        {'frames': n, 'loop': True, 'fps': fps + 3, **idle_ref},
        },
    }
    with open(os.path.join(skin_dir, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    total = sum(os.path.getsize(os.path.join(idle_dir, p)) for p in os.listdir(idle_dir))
    print(f'\n[OK] 皮肤已生成: {skin_dir}')
    print(f'   帧数 {n}，磁盘占用 {total/1024/1024:.1f} MB，内存约 {out_w*out_h*4*n/1024/1024:.0f} MB')
    print(f'   高潮段 start={stand_start} len={stand_len}，fps={fps}')


if __name__ == '__main__':
    main()
