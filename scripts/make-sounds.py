#!/usr/bin/env python3
"""Synthesizes every sound in public/audio from scratch (numpy only, no samples).

Because nothing is sampled, there are no third-party licenses: the output is dedicated to the
public domain (CC0 1.0) along with this script. Re-run to regenerate:

    python3 scripts/make-sounds.py && ls -la public/audio
Requires numpy and ffmpeg (libmp3lame).
"""
import os
import subprocess
import tempfile
import wave

import numpy as np

SR = 22050
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'audio')
rng = np.random.default_rng(7)


def onepole_lp(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def biquad_bp(x, f0, q):
    w = 2 * np.pi * f0 / SR
    alpha = np.sin(w) / (2 * q)
    b0, b1, b2 = alpha, 0.0, -alpha
    a0, a1, a2 = 1 + alpha, -2 * np.cos(w), 1 - alpha
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, o
        y[i] = o
    return y


def norm(x, peak=0.8):
    return x / (np.max(np.abs(x)) + 1e-9) * peak


def loop_crossfade(x, fade):
    """Make x loop seamlessly: fold its last `fade` samples into its start."""
    n = len(x) - fade
    out = x[:n].copy()
    ramp = np.linspace(0, 1, fade)
    out[:fade] = x[:fade] * ramp + x[n:] * (1 - ramp)
    return out


def write(name, x, kbps):
    x = np.clip(x, -1, 1)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        path = f.name
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())
    dst = os.path.join(OUT, name)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', path, '-ac', '1', '-ar', str(SR), '-b:a', f'{kbps}k', dst], check=True)
    os.remove(path)
    print(name, os.path.getsize(dst), 'bytes')


def rain():
    secs, fade = 10.0, int(0.8 * SR)
    n = int(secs * SR) + fade
    white = rng.standard_normal(n)
    body = onepole_lp(white, 900) * 0.9 + onepole_lp(white, 3500) * 0.25
    body -= onepole_lp(body, 120)  # take out rumble
    # Drops on glass: short, bright, decaying pings at random times.
    drops = np.zeros(n)
    t = np.arange(int(0.03 * SR)) / SR
    for _ in range(int(secs * 26)):
        at = rng.integers(0, n - len(t))
        f = rng.uniform(1800, 5200)
        drops[at:at + len(t)] += np.sin(2 * np.pi * f * t) * np.exp(-t * rng.uniform(140, 260)) * rng.uniform(0.05, 0.25)
    x = norm(body, 0.55) + drops * 0.6
    write('rain.mp3', norm(loop_crossfade(x, fade), 0.7), 40)


def ep_note(freq, dur, vel=1.0):
    t = np.arange(int(dur * SR)) / SR
    env = np.exp(-t * 2.2) * (1 - np.exp(-t * 400))
    tone = (np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * 2 * freq * t) * np.exp(-t * 6)
            + 0.12 * np.sin(2 * np.pi * 3 * freq * t) * np.exp(-t * 9))
    trem = 1 + 0.12 * np.sin(2 * np.pi * 4.5 * t)
    return tone * env * trem * vel


def lofi():
    bpm = 72
    beat = 60 / bpm
    bar = 4 * beat
    chords = [  # Fmaj7, Em7, Dm7, Cmaj7 (MIDI)
        [53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59],
    ]
    loop = len(chords) * bar
    n = int(loop * SR)
    total = np.zeros(n * 2 + SR * 3)
    hz = lambda m: 440 * 2 ** ((m - 69) / 12)
    for rep in range(2):  # render twice and keep the 2nd pass: tails wrap into the loop start
        for ci, ch in enumerate(chords):
            start = rep * loop + ci * bar
            for k, m in enumerate(ch):
                a = int((start + k * 0.012) * SR)  # tiny strum
                note = ep_note(hz(m), bar * 1.1, 0.22)
                total[a:a + len(note)] += note
            bass = ep_note(hz(ch[0] - 12), bar * 0.9, 0.35)
            a = int(start * SR)
            total[a:a + len(bass)] += bass
            for b in range(4):  # soft kick on 1 and 3, brushed hat on the off-beats
                tb = start + b * beat
                if b % 2 == 0:
                    t = np.arange(int(0.25 * SR)) / SR
                    kick = np.sin(2 * np.pi * (45 + 60 * np.exp(-t * 30)) * t) * np.exp(-t * 14) * 0.5
                    i = int(tb * SR)
                    total[i:i + len(kick)] += kick
                t = np.arange(int(0.05 * SR)) / SR
                hat = rng.standard_normal(len(t)) * np.exp(-t * 90) * 0.05
                i = int((tb + beat / 2) * SR)
                total[i:i + len(hat)] += hat
    x = total[n:2 * n]
    x = onepole_lp(onepole_lp(x, 2600), 4200)  # warm, a bit muffled
    crackle = np.zeros(n)
    idx = rng.integers(0, n, int(loop * 9))
    crackle[idx] = rng.uniform(-0.25, 0.25, len(idx))
    x = norm(x, 0.7) + onepole_lp(crackle, 3000) * 0.5 + onepole_lp(rng.standard_normal(n), 400) * 0.01
    write('lofi.mp3', norm(x, 0.7), 48)


def hum():
    secs = 2.0  # 120 Hz fits exactly: seamless loop
    t = np.arange(int(secs * SR)) / SR
    x = (np.sin(2 * np.pi * 120 * t) + 0.5 * np.sin(2 * np.pi * 240 * t) + 0.25 * np.sin(2 * np.pi * 360 * t)
         + 0.08 * np.sign(np.sin(2 * np.pi * 120 * t)))
    write('hum.mp3', norm(x, 0.5), 32)


def key():
    t = np.arange(int(0.07 * SR)) / SR
    click = rng.standard_normal(len(t)) * np.exp(-t * 300)
    click = click - onepole_lp(click, 1500)
    thock = np.sin(2 * np.pi * 210 * t) * np.exp(-t * 80) * 0.6
    write('key.mp3', norm(click * 0.6 + thock, 0.8), 32)


def quack():
    dur = 0.32
    t = np.arange(int(dur * SR)) / SR
    f0 = 560 - 220 * (t / dur) + 18 * np.sin(2 * np.pi * 28 * t)
    phase = 2 * np.pi * np.cumsum(f0) / SR
    saw = 2 * ((phase / (2 * np.pi)) % 1) - 1
    nasal = biquad_bp(saw, 1100, 3.5) + biquad_bp(saw, 2400, 5) * 0.6 + biquad_bp(saw, 700, 4) * 0.4
    env = np.minimum(1, t * 60) * np.exp(-((t - 0.05).clip(0)) * 7)
    write('quack.mp3', norm(nasal * env, 0.85), 40)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    rain()
    lofi()
    hum()
    key()
    quack()
