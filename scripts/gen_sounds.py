#!/usr/bin/env python3
"""程序化合成提示音（纯 Python 标准库，零依赖、免费、可离线重生成）。

为什么不直接放 mp3：项目此前「提醒音效」开关是空壳，没有任何音频资源。
用脚本合成而非引入外部音频，好处是体积可控（每条 < 60KB）、无版权问题、
调音色只要改参数重跑本脚本。

用法：  python scripts/gen_sounds.py
输出：  resources/sounds/*.wav
"""
import math
import os
import struct
import wave

SR = 44100                       # 采样率
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resources', 'sounds')

# 十二平均律（Hz），够覆盖下面几条音效
N = {
    'C4': 261.63, 'E4': 329.63, 'G4': 392.00, 'A4': 440.00,
    'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'G5': 783.99, 'A5': 880.00,
    'C6': 1046.50, 'E6': 1318.51,
}


def adsr(t, dur, attack=0.006, release=0.12):
    """包络：起音淡入、结尾淡出，避免爆音（click）。"""
    if t < attack:
        return t / attack
    if t > dur - release:
        return max(0.0, (dur - t) / release)
    return 1.0


def render(notes, harmonics=(1.0, 0.26, 0.09), gain=0.55):
    """把[(频率, 起始秒, 时长秒), ...]混成一段单声道 PCM。"""
    total = max(s + d for _, s, d in notes) + 0.06
    frames = bytearray()
    for i in range(int(total * SR)):
        t = i / SR
        value = 0.0
        for freq, start, dur in notes:
            if freq and start <= t < start + dur:
                lt = t - start
                wave_sum = sum(
                    amp * math.sin(2 * math.pi * freq * (k + 1) * lt)
                    for k, amp in enumerate(harmonics)
                )
                value += wave_sum * adsr(lt, dur)
        value = max(-1.0, min(1.0, value * gain))
        frames += struct.pack('<h', int(value * 32767))
    return bytes(frames)


def write_wav(name, pcm):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm)
    print(f'  {name:18s} {len(pcm) / 1024:6.1f} KB  {len(pcm) / 2 / SR:.2f}s')


print(f'输出目录：{OUT}')

# 上涨：明亮上行琶音 do-mi-sol-do，钟琴感（泛音偏多）
write_wav('alert-up.wav', render([
    (N['C5'], 0.00, 0.20), (N['E5'], 0.10, 0.20),
    (N['G5'], 0.20, 0.20), (N['C6'], 0.30, 0.42),
], harmonics=(1.0, 0.34, 0.14, 0.05), gain=0.50))

# 下跌：下行 mi-do-sol，音色偏暗（泛音少、时长略长）
write_wav('alert-down.wav', render([
    (N['E5'], 0.00, 0.26), (N['C5'], 0.18, 0.26), (N['G4'], 0.36, 0.46),
], harmonics=(1.0, 0.16, 0.05), gain=0.52))

# 定时时点：柔和双音叮咚 sol-mi，长余韵像小铃铛
write_wav('alert-time.wav', render([
    (N['G5'], 0.00, 0.34), (N['E5'], 0.24, 0.56),
], harmonics=(1.0, 0.30, 0.18, 0.10), gain=0.46))

# 更新提示：轻快三连 do-mi-sol，短促不扰人
write_wav('update.wav', render([
    (N['C5'], 0.00, 0.14), (N['E5'], 0.10, 0.14), (N['G5'], 0.20, 0.30),
], harmonics=(1.0, 0.28, 0.10), gain=0.48))

print('完成。')
