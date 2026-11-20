# Makes the Apple apps' theme sounds: python3 scripts/apple-sounds.py Apple/Shared/Themes/Sounds
# One theme's sounds so far: Liquid Glass (a thin pane's tink, a pair of chimes, three rising chimes), made
# with the same recipe as the Android theme of that name (scripts/android-sounds.py). Original, tiny, quiet.
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
