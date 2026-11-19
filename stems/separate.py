"""Vocal separation for ECHO's Karaoke mode (stems/README.md).

An MDX-Net model (UVR-MDX-NET-Inst_HQ_3, from the Ultimate Vocal Remover project, MIT) run with
ONNX Runtime on the CPU: the song's spectrogram goes in chunk by chunk, the instrumental's comes
out; the vocals are what the instrumental leaves of the mix. NumPy does the STFT, so no PyTorch.
"""

import numpy as np

SR = 44100


class Separator:
    def __init__(self, model_path, threads=2, n_fft=6144, hop=1024, compensate=1.022):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        opts.inter_op_num_threads = 1
        # No arena: ONNX Runtime would otherwise keep ~2.5 GB pooled between chunks.
        opts.enable_cpu_mem_arena = False
        opts.enable_mem_pattern = False
        self.session = ort.InferenceSession(model_path, opts, providers=["CPUExecutionProvider"])
        shape = self.session.get_inputs()[0].shape  # [batch, 4, dim_f, dim_t]
        self.dim_f, self.dim_t = int(shape[2]), int(shape[3])
        self.n_fft, self.hop, self.compensate = n_fft, hop, compensate
        self.window = np.hanning(n_fft + 1)[:-1].astype(np.float32)  # periodic Hann
        self.chunk = hop * (self.dim_t - 1)
        self.trim = n_fft // 2
        self.gen = self.chunk - 2 * self.trim

    def _stft(self, x):
        """x: [2, chunk] -> [2, bins, frames] complex (centred, reflect-padded, as torch.stft)."""
        pad = self.n_fft // 2
        x = np.pad(x, ((0, 0), (pad, pad)), mode="reflect")
        frames = 1 + (x.shape[1] - self.n_fft) // self.hop
        idx = np.arange(self.n_fft)[None, :] + self.hop * np.arange(frames)[:, None]
        seg = x[:, idx] * self.window  # [2, frames, n_fft]
        return np.fft.rfft(seg, axis=-1).transpose(0, 2, 1)

    def _istft(self, spec, length):
        """spec: [2, bins, frames] -> [2, length] (overlap-add, window-square normalised)."""
        frames = spec.shape[2]
        seg = np.fft.irfft(spec.transpose(0, 2, 1), n=self.n_fft, axis=-1) * self.window
        total = self.n_fft + self.hop * (frames - 1)
        out = np.zeros((2, total), dtype=np.float32)
        norm = np.zeros(total, dtype=np.float32)
        w2 = self.window**2
        for f in range(frames):
            s = f * self.hop
            out[:, s : s + self.n_fft] += seg[:, f]
            norm[s : s + self.n_fft] += w2
        out /= np.maximum(norm, 1e-8)
        pad = self.n_fft // 2
        return out[:, pad : pad + length]

    def _run(self, waves):
        spec = self._stft(waves)[:, : self.dim_f, : self.dim_t]
        spec[:, :3] = 0  # the lowest bins are rumble the model was trained without
        # [1, 4, f, t] as torch.stft lays it out: L real, L imag, R real, R imag
        x = np.stack([spec.real, spec.imag], axis=1).reshape(1, 4, self.dim_f, self.dim_t).astype(np.float32)
        y = self.session.run(None, {self.session.get_inputs()[0].name: x})[0][0]
        out = np.zeros((2, self.n_fft // 2 + 1, self.dim_t), dtype=np.complex64)
        y = y.reshape(2, 2, self.dim_f, self.dim_t)
        out[:, : self.dim_f] = y[:, 0] + 1j * y[:, 1]
        return self._istft(out, self.chunk)

    def instrumental(self, mix, progress=None, overlap=0.25):
        """mix: float32 frames [n, 2] (a memmap is fine) or [2, n], at 44.1 kHz -> the instrumental, [2, n].

        Chunks overlap by [overlap] and are blended with a Hann window, as the reference
        implementation (audio-separator) does: no seams where one chunk meets the next. The mix is
        read a chunk at a time, so beside it only the result is held: about 1.5x the song.
        """
        frames = mix if mix.shape[1] == 2 else mix.T  # [n, 2] views either way
        n = frames.shape[0]
        peak = 0.0
        for b in range(0, n, 1 << 20):
            peak = max(peak, float(np.abs(frames[b : b + (1 << 20)]).max()))
        scale = 0.9 / peak if peak > 0.9 else 1.0  # the model expects a mix that doesn't clip
        step = int((1 - overlap) * self.chunk)
        total = n + 2 * self.trim
        pad = (step - (total - self.chunk) % step) % step if total > self.chunk else self.chunk - total
        length = total + pad
        out = np.zeros((2, length), np.float32)
        weight = np.zeros(length, np.float32)
        window = np.hanning(self.chunk).astype(np.float32) + 1e-3
        starts = list(range(0, length - self.chunk + 1, step))
        for k, i in enumerate(starts):
            # The chunk in padded time [i, i + chunk) is the mix's [i - trim, ...), zeros outside it.
            part = np.zeros((2, self.chunk), np.float32)
            a, b = max(0, i - self.trim), min(n, i - self.trim + self.chunk)
            if b > a:
                part[:, a - (i - self.trim) : b - (i - self.trim)] = frames[a:b].T * scale
            out[:, i : i + self.chunk] += self._run(part) * window
            weight[i : i + self.chunk] += window
            if progress:
                progress((k + 1) / len(starts))
        out /= np.maximum(weight, 1e-6)
        del weight
        inst = out[:, self.trim : self.trim + n]
        inst *= self.compensate / scale
        return inst
