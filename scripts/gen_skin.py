#!/usr/bin/env python3
"""生成占位桌宠皮肤帧（纯色像素猫剪影）+ 托盘图标。正式素材按文档 §15 替换。"""
from PIL import Image, ImageDraw
import os, json

SKIN_DIR = os.path.join(os.path.dirname(__file__), '..', 'resources', 'skins', 'mascot-cat')
ICON_DIR = os.path.join(os.path.dirname(__file__), '..', 'resources', 'icons')

W, H = 128, 128

def cat_frame(pose: str, i: int, n: int) -> Image.Image:
    """画一只极简像素猫剪影。pose 决定姿态，i/n 决定帧内偏移（呼吸/摇摆）。"""
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bob = int(2 * (1 if pose != 'sleep' else 0) * (0.5 if i == n // 2 else 1))
    body_color = (245, 190, 100, 255)  # 橘
    line = (120, 80, 40, 255)
    # 身体（椭圆）
    d.ellipse([34, 60 + bob, 94, 108 + bob], fill=body_color, outline=line, width=2)
    # 头
    d.ellipse([40, 28 + bob, 88, 72 + bob], fill=body_color, outline=line, width=2)
    # 耳朵（三角）
    d.polygon([(46, 34 + bob), (56, 12 + bob), (62, 32 + bob)], fill=body_color, outline=line)
    d.polygon([(66, 32 + bob), (76, 12 + bob), (84, 34 + bob)], fill=body_color, outline=line)
    # 眼睛
    eye_y = 46 + bob
    if pose == 'sleep':
        d.line([(52, eye_y), (58, eye_y)], fill=line, width=2)
        d.line([(70, eye_y), (76, eye_y)], fill=line, width=2)
    else:
        d.ellipse([52, eye_y - 3, 58, eye_y + 3], fill=(40, 30, 20, 255))
        d.ellipse([70, eye_y - 3, 76, eye_y + 3], fill=(40, 30, 20, 255))
    # 嘴（情绪）
    mouth_y = 58 + bob
    if pose == 'happy':
        d.arc([58, mouth_y - 4, 70, mouth_y + 4], 20, 160, fill=line, width=2)
    elif pose == 'sad':
        d.arc([58, mouth_y - 2, 70, mouth_y + 6], 200, 340, fill=line, width=2)
    else:
        d.line([(62, mouth_y), (66, mouth_y)], fill=line, width=2)
    # 尾巴
    tail_swing = 6 if pose in ('happy', 'panic') else 3
    d.arc([86, 70 + bob, 116, 100 + bob], -80 + tail_swing * (i % 2), 60, fill=line, width=4)
    # 涨跌标记
    if pose == 'happy':
        d.text((98, 20), '↑', fill=(220, 60, 60, 255))
    elif pose == 'sad':
        d.text((98, 20), '↓', fill=(60, 180, 100, 255))
    if pose == 'panic':
        d.text((4, 12), '!', fill=(230, 90, 30, 255))
    # Zzz
    if pose == 'sleep':
        d.text((98, 16), 'z', fill=(150, 170, 200, 255))
        d.text((106, 8), 'z', fill=(150, 170, 200, 255))
    return img

actions = {
    'idle':       dict(frames=8,  loop=True,  next=None),
    'idle-smile': dict(frames=8,  loop=True,  next=None),
    'idle-frown': dict(frames=8,  loop=True,  next=None),
    'happy':      dict(frames=10, loop=False, next='idle-smile'),
    'sad':        dict(frames=10, loop=False, next='idle-frown'),
    'panic-happy':dict(frames=6,  loop=True,  next=None),
    'panic-sad':  dict(frames=6,  loop=True,  next=None),
    'sleep':      dict(frames=6,  loop=True,  next=None),
    'offline':   dict(frames=6,  loop=True,  next=None),
    'walk':       dict(frames=8,  loop=True,  next=None),
}

pose_map = {
    'idle': 'idle', 'idle-smile': 'happy', 'idle-frown': 'sad', 'happy': 'happy',
    'sad': 'sad', 'panic-happy': 'panic', 'panic-sad': 'panic', 'sleep': 'sleep',
    'offline': 'sleep', 'walk': 'idle',
}

manifest = {'name': '像素橘猫（占位）', 'fps': 12, 'anchor': [0.5, 1.0], 'actions': {}}

for action, cfg in actions.items():
    adir = os.path.join(SKIN_DIR, 'actions', action)
    os.makedirs(adir, exist_ok=True)
    pose = pose_map[action]
    if 'smile' in action: pose = 'happy'
    if 'frown' in action: pose = 'sad'
    if 'happy' in action and 'panic' not in action: pose = 'happy'
    if 'sad' in action and 'panic' not in action: pose = 'sad'
    for i in range(1, cfg['frames'] + 1):
        cat_frame(pose, i, cfg['frames']).save(os.path.join(adir, f'{i:04d}.png'))
    manifest['actions'][action] = cfg

with open(os.path.join(SKIN_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

# 托盘图标
os.makedirs(ICON_DIR, exist_ok=True)
icon = cat_frame('idle', 1, 8).resize((32, 32), Image.NEAREST)
icon.save(os.path.join(ICON_DIR, 'tray.png'))

print('skin + icon generated at', SKIN_DIR)
