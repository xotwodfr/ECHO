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
/// ALSA on the dev box). A song from the server plays as it arrives (ProgressiveStream: sound from the
/// first bytes, the cover art skipped; SoundFlow's own NetworkDataProvider asked three times and
/// downloaded the whole song first, 2–4 s of silence); a local path (tests) plays from the file. With
/// no audio device (or `nullDevice`, the tests) a thread pulls the mixer at real time instead: silent,
/// but the song and its position run.
public sealed class AudioOut : IDisposable
{
    static readonly AudioFormat DeviceFormat = new() { Format = SampleFormat.F32, Channels = 2, SampleRate = 48_000 };

    readonly MiniAudioEngine engine;
    readonly AudioPlaybackDevice? device;
    readonly Mixer mixer;
    readonly CancellationTokenSource stop = new();
    readonly object sync = new(); // the song in play changes on a worker
    SoundPlayer? player;
    ISoundDataProvider? provider;
    ProgressiveStream? download;
    float volume = 1;
    bool muted;

    public AudioOut(bool nullDevice = false)
    {
        engine = new MiniAudioEngine();
        engine.RegisterCodecFactory(new Mp3WithoutSeekTable());
        if (!nullDevice)
            try
            {
                device = engine.InitializePlaybackDevice(null, DeviceFormat, new MiniAudioDeviceConfig());
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
                frames += buffer.Length / DeviceFormat.Channels;
            }
            Thread.Sleep(5);
        }
    }

    /// The song ended by itself (not a pause, a stop or another Open).
    public event Action? Ended;

    /// Opens a song arriving over HTTP (`fetch(from)` answers with its bytes from `from` on), replacing
    /// the current one: only its headers and as much of it as the decoder reads to start are waited for.
    /// It starts at `at`, playing if `play`, as soon as it can, on a worker (the window may be busy
    /// laying out the new song). The decoder converts to the device's format: a 44.1 kHz song on a
    /// 48 kHz device keeps its pitch.
    public Task Open(Func<long, CancellationToken, Task<HttpResponseMessage>> fetch, TimeSpan at = default, bool play = false) =>
        Open(async () =>
        {
            var stream = await ProgressiveStream.Open(fetch);
            try
            {
                return (new StreamDataProvider(engine, DeviceFormat, stream), stream);
            }
            catch
            {
                stream.Dispose();
                throw;
            }
        }, at, play);

    /// Opens a file (tests), as above.
    public Task Open(string path, TimeSpan at = default, bool play = false) =>
        Open(() =>
        {
            var file = File.OpenRead(path);
            try
            {
                return Task.FromResult<(ISoundDataProvider, ProgressiveStream?)>((new StreamDataProvider(engine, DeviceFormat, file), null));
            }
            catch
            {
                file.Dispose(); // a file the decoder refused: let go of it (Windows locks open files)
                throw;
            }
        }, at, play);

    int opened;

    /// A song asked for after this one wins: this one is dropped when it is ready.
    async Task Open(Func<Task<(ISoundDataProvider, ProgressiveStream?)>> make, TimeSpan at, bool play)
    {
        var mine = Interlocked.Increment(ref opened);
        await Task.Run(async () =>
        {
            var (next, arriving) = await make();
            SoundPlayer p;
            lock (sync)
            {
                if (mine != opened)
                {
                    arriving?.Dispose();
                    (next as IDisposable)?.Dispose();
                    return;
                }
                Close();
                (provider, download) = (next, arriving);
                p = player = new SoundPlayer(engine, DeviceFormat, next) { Volume = volume, Mute = muted };
                p.PlaybackEnded += (_, _) => Ended?.Invoke();
                mixer.AddComponent(p);
            }
            if (at > TimeSpan.Zero) p.Seek(at, SeekOrigin.Begin); // before Play: no blip of the song's start
            if (play) p.Play();
        });
    }

    public void Play()
    {
        lock (sync) player?.Play();
    }

    public void Pause()
    {
        lock (sync) player?.Pause();
    }

    public bool Playing => player?.State == PlaybackState.Playing;

    Task seeking = Task.CompletedTask;

    /// Seeks on a worker, each seek after the one before: a seek past what has arrived waits for those
    /// bytes, and the window must not wait with it. Done when the seek has landed.
    public Task Seek(TimeSpan t)
    {
        if (player is not { } p) return Task.CompletedTask;
        return seeking = seeking.ContinueWith(_ =>
        {
            try
            {
                p.Seek(t, SeekOrigin.Begin);
            }
            catch (ObjectDisposedException) { } // another song opened meanwhile
        }, TaskScheduler.Default);
    }

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
        // First, so a read (the mixer's or a seek's) waiting for bytes lets go at once.
        download?.Dispose();
        download = null;
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
        lock (sync) Close();
        device?.Stop();
        device?.Dispose();
        engine.Dispose();
    }
}

/// MP3 through miniaudio as SoundFlow's own factory does, but without its 100-point seek table: building
/// one reads the whole file before the first sound (over HTTP, waits for all of it). The length comes from
/// the Xing/Info header instead, and a seek walks the frame headers from the start.
sealed class Mp3WithoutSeekTable : ICodecFactory
{
    public string FactoryId => "ECHO.Mp3WithoutSeekTable";

    public IReadOnlyCollection<string> SupportedFormatIds { get; } = ["mp3"];

    public int Priority => 1; // ahead of SoundFlow's (0)

    // SoundFlow keeps the decoder class internal (its constructor is public). Should a later SoundFlow
    // rename it, the engine logs this factory's failure and falls back to its own: slower, still plays.
    static readonly Type Decoder = typeof(MiniAudioEngine).Assembly.GetType("SoundFlow.Backends.MiniAudio.MiniAudioDecoder", throwOnError: true)!;

    public ISoundDecoder CreateDecoder(Stream stream, string formatId, AudioFormat format) =>
        (ISoundDecoder)Activator.CreateInstance(Decoder, stream, format.Format, format.Channels, format.SampleRate, 0u)!;

    public ISoundDecoder? TryCreateDecoder(Stream stream, out AudioFormat detectedFormat, AudioFormat? hintFormat = null)
    {
        detectedFormat = default;
        return null; // probing stays SoundFlow's
    }

    public ISoundEncoder? CreateEncoder(Stream stream, string formatId, AudioFormat format) => null;
}
