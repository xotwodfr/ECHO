# Makes the Android app's theme sounds (res/raw): python3 scripts/android-sounds.py Android/app/src/main/res/raw
# Synthesizes the theme sounds (original, made here): clay squish and pop, yarn thump and needle click.
import numpy as np, wave, sys
SR = 44100
rng = np.random.default_rng(7)
def t(sec): return np.arange(int(SR * sec)) / SR
def lowpass(x, cutoff):
    # one-pole low-pass, applied twice
    a = np.exp(-2 * np.pi * cutoff / SR)
    for _ in range(2):
        y = np.zeros_like(x); acc = 0.0
        for i, v in enumerate(x): acc = (1 - a) * v + a * acc; y[i] = acc
        x = y
    return x
def highpass(x, cutoff): return x - lowpass(x, cutoff)
def env(n, attack, decay):
    k = np.arange(n) / SR
    return np.minimum(1, k / attack) * np.exp(-k / decay)
def save(name, x, gain=0.7):
    x = x / (np.max(np.abs(x)) + 1e-9) * gain
    fade = min(len(x), int(SR * 0.004)); x[-fade:] *= np.linspace(1, 0, fade)
    with wave.open(f"{sys.argv[1]}/{name}.wav", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())

# Clay, pressed: a soft wet squish (low-passed noise, wobbling) under a sagging low tone.
k = t(0.16); n = len(k)
squish = lowpass(rng.standard_normal(n), 1100) * (1 + 0.6 * np.sin(2 * np.pi * 34 * k)) * env(n, 0.006, 0.05)
body = np.sin(2 * np.pi * np.cumsum(np.linspace(230, 120, n)) / SR) * env(n, 0.004, 0.045)
save("clay_press", squish * 1.0 + body * 0.55, 0.62)
# Clay, let go: a small rounded pop.
k = t(0.07); n = len(k)
pop = np.sin(2 * np.pi * np.cumsum(np.linspace(420, 760, n)) / SR) * env(n, 0.002, 0.018)
click = highpass(rng.standard_normal(n), 2500) * env(n, 0.0005, 0.004)
save("clay_pop", pop + click * 0.25, 0.5)
# Clay, right / done: a squish then a pop.
save("clay_yes", np.concatenate([lowpass(rng.standard_normal(int(SR*0.09)), 1300) * env(int(SR*0.09), 0.005, 0.03), np.zeros(int(SR*0.02)), pop + click * 0.25]), 0.6)

# Yarn, pressed: a muffled woollen thump with a faint rustle of fibre.
k = t(0.13); n = len(k)
thump = lowpass(rng.standard_normal(n), 380) * env(n, 0.005, 0.035) + np.sin(2 * np.pi * 88 * k) * env(n, 0.004, 0.03) * 0.5
rustle = highpass(lowpass(rng.standard_normal(n), 6500), 2500) * env(n, 0.01, 0.05) * 0.18
save("yarn_press", thump + rustle, 0.6)
# Yarn, a knitting needle: a dry wooden tick.
k = t(0.05); n = len(k)
tick = (np.sin(2 * np.pi * 1850 * k) + 0.6 * np.sin(2 * np.pi * 2730 * k) + 0.3 * np.sin(2 * np.pi * 4100 * k)) * env(n, 0.0004, 0.009)
save("yarn_click", tick + highpass(rng.standard_normal(n), 3000) * env(n, 0.0003, 0.002) * 0.3, 0.45)
# Yarn, right / done: two needle ticks.
gap = np.zeros(int(SR * 0.06))
save("yarn_yes", np.concatenate([tick, gap, tick * 0.9]), 0.45)
