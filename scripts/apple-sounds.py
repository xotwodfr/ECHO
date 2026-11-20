# Makes the Apple apps' theme sounds: python3 scripts/apple-sounds.py Apple/Shared/Themes/Sounds
# The sounds of Liquid Glass, Clay, Yarn, Paper & origami and Retro hi-fi, with the recipes of the Android theme of the
# same name (scripts/android-sounds.py): original, tiny and quiet, made here.
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

# Glass, tapped: a short bright tink (inharmonic partials of a thin pane), a soft knock under it.
k = t(0.22); n = len(k)
tink = sum(a * np.sin(2 * np.pi * f * k) * np.exp(-k / d) for f, a, d in [(2350, 1, 0.06), (3870, 0.55, 0.035), (5610, 0.3, 0.02), (1210, 0.25, 0.08)])
knock = lowpass(rng.standard_normal(n), 900) * env(n, 0.001, 0.006)
save("glass_press", tink * np.minimum(1, k / 0.0008) + knock * 0.5, 0.42)
# Glass, a toggle: a rising pair of chimes.
k = t(0.12); n = len(k)
chime = lambda f: sum(a * np.sin(2 * np.pi * f * m * k) * np.exp(-k / d) for m, a, d in [(1, 1, 0.07), (2.76, 0.4, 0.03)]) * np.minimum(1, k / 0.0008)
save("glass_click", np.concatenate([chime(1760), chime(2350)[: int(SR * 0.1)]]), 0.38)
# Glass, right: three rising chimes.
save("glass_yes", np.concatenate([chime(1760)[: int(SR * 0.08)], chime(2217)[: int(SR * 0.08)], chime(2637)]), 0.4)

# Paper, pressed: a crisp rustle (band-passed noise in little crackles) with a soft card tap.
k = t(0.12); n = len(k)
crackle = highpass(lowpass(rng.standard_normal(n), 7000), 1800) * (rng.random(n) < 0.35) * env(n, 0.002, 0.04)
tap = lowpass(rng.standard_normal(n), 600) * env(n, 0.001, 0.012)
save("paper_press", crackle + tap * 0.6, 0.55)
# Paper, a fold: a short swish then a crisp crease.
k = t(0.14); n = len(k)
swish = highpass(lowpass(rng.standard_normal(n), 5000), 900) * np.sin(np.pi * np.minimum(1, k / 0.1)) ** 2 * 0.5
crease = highpass(rng.standard_normal(n), 2500) * np.exp(-np.maximum(0, k - 0.1) / 0.006) * (k >= 0.1)
save("paper_click", swish + crease, 0.5)
# Paper, right: two folds.
save("paper_yes", np.concatenate([swish + crease, swish[: int(SR * 0.06)] * 0.7 + crease[: int(SR * 0.06)]]), 0.5)

# Hi-fi, pressed: a weighty switch thunk (a damped low tone and a metal contact click).
k = t(0.12); n = len(k)
thunk = np.sin(2 * np.pi * np.cumsum(np.linspace(160, 95, n)) / SR) * env(n, 0.001, 0.03)
contact = highpass(rng.standard_normal(n), 3500) * env(n, 0.0002, 0.0025) + np.sin(2 * np.pi * 3100 * k) * env(n, 0.0003, 0.006) * 0.4
save("hifi_press", thunk + contact * 0.6, 0.55)
# Hi-fi, a knob's detent: a tiny dry click.
k = t(0.035); n = len(k)
detent = highpass(rng.standard_normal(n), 2000) * env(n, 0.0002, 0.0018) + np.sin(2 * np.pi * 2400 * k) * env(n, 0.0002, 0.004) * 0.5
save("hifi_click", detent, 0.4)
# Hi-fi, right: two detents and a thunk.
save("hifi_yes", np.concatenate([detent, np.zeros(int(SR * 0.04)), detent, np.zeros(int(SR * 0.05)), thunk + contact * 0.6]), 0.5)
