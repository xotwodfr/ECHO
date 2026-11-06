using SoundFlow.Abstracts;
using SoundFlow.Abstracts.Devices;
using SoundFlow.Backends.MiniAudio;
using SoundFlow.Backends.MiniAudio.Devices;
using SoundFlow.Components;
using SoundFlow.Enums;
using SoundFlow.Interfaces;
using SoundFlow.Providers;
using SoundFlow.Structs;

namespace Echo.Playback;

/// One song at a time to the speakers through SoundFlow (miniaudio: WASAPI on Windows, PulseAudio or
/// ALSA on the dev box), with everything that reaches the device handed to the tap for the room. A
/// signed stream URL streams over HTTP; a local path (tests) plays from the file. With no audio device
/// (or `nullDevice`, the tests) a thread pulls the mixer at real time instead: silent, but the song,
/// its position and the room all run.
public sealed class AudioOut : IDisposable
{
    static readonly AudioFormat DeviceFormat = new() { Format = SampleFormat.F32, Channels = 2, SampleRate = 48_000 };

    readonly MiniAudioEngine engine;
    readonly AudioPlaybackDevice? device;
    readonly Mixer mixer;
    readonly AudioTap tap;
    readonly CancellationTokenSource stop = new();
    SoundPlayer? player;
    ISoundDataProvider? provider;
    float volume = 1;
    bool muted;

    public AudioOut(AudioTap tap, bool nullDevice = false)
    {
        this.tap = tap;
        engine = new MiniAudioEngine();
        if (!nullDevice)
            try
            {
                device = engine.InitializePlaybackDevice(null, DeviceFormat, new MiniAudioDeviceConfig());
                device.OnAudioProcessed += (samples, _) => tap.Write(samples, DeviceFormat.Channels, DeviceFormat.SampleRate);
                device.Start();
            }
            catch (Exception e)
            {
                Console.Error.WriteLine($"ECHO audio: no output device ({e.Message}); playing silently");
                device = null;
            }
        mixer = device?.MasterMixer ?? new Mixer(engine, DeviceFormat);
        if (device is null) new Thread(Pump) { IsBackground = true, Name = "ECHO silent output" }.Start();
    }

    /// The null device: 10 ms of the mix at a time, paced by the clock.
    void Pump()
    {
        var buffer = new float[DeviceFormat.SampleRate / 100 * DeviceFormat.Channels];
        var clock = System.Diagnostics.Stopwatch.StartNew();
        long frames = 0;
        while (!stop.IsCancellationRequested)
        {
            while (frames < clock.Elapsed.TotalSeconds * DeviceFormat.SampleRate)
            {
                Array.Clear(buffer);
                mixer.Process(buffer, DeviceFormat.Channels);
                tap.Write(buffer, DeviceFormat.Channels, DeviceFormat.SampleRate);
                frames += buffer.Length / DeviceFormat.Channels;
            }
            Thread.Sleep(5);
        }
    }

    /// The song ended by itself (not a pause, a stop or another Open).
    public event Action? Ended;

    /// Opens `source` paused, replacing the current song. HTTP opens on a worker: it reads headers first.
    /// The decoder converts to the device's format: a 44.1 kHz song on a 48 kHz device keeps its pitch.
    public async Task Open(string source)
    {
        var next = await Task.Run<ISoundDataProvider>(() =>
        {
            if (source.StartsWith("http", StringComparison.OrdinalIgnoreCase)) return new NetworkDataProvider(engine, DeviceFormat, source);
            var file = File.OpenRead(source);
            try
            {
                return new StreamDataProvider(engine, DeviceFormat, file);
            }
            catch
            {
                file.Dispose(); // a file the decoder refused: let go of it (Windows locks open files)
                throw;
            }
        });
        Close();
        provider = next;
        player = new SoundPlayer(engine, DeviceFormat, next) { Volume = volume, Mute = muted };
        player.PlaybackEnded += (_, _) => Ended?.Invoke();
        mixer.AddComponent(player);
    }

    public void Play() => player?.Play();

    public void Pause() => player?.Pause();

    public bool Playing => player?.State == PlaybackState.Playing;

    public void Seek(TimeSpan t) => player?.Seek(t, SeekOrigin.Begin);

    public TimeSpan Position => TimeSpan.FromSeconds(player?.Time ?? 0);

    public TimeSpan Duration => TimeSpan.FromSeconds(player?.Duration ?? 0);

    public float Volume
    {
        get => volume;
        set
        {
            volume = Math.Clamp(value, 0, 1);
            if (player is not null) player.Volume = volume;
        }
    }

    public bool Muted
    {
        get => muted;
        set
        {
            muted = value;
            if (player is not null) player.Mute = value;
        }
    }

    void Close()
    {
        if (player is not null)
        {
            mixer.RemoveComponent(player);
            player.Dispose();
            player = null;
        }
        (provider as IDisposable)?.Dispose();
        provider = null;
    }

    public void Dispose()
    {
        stop.Cancel();
        Close();
        device?.Stop();
        device?.Dispose();
        engine.Dispose();
    }
}
