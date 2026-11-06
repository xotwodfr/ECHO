using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using Echo.Playback;

namespace Echo.Ui;

/// Everything one signed-in window shares: the server (or the built-in fixtures), covers, where the
/// shell is, and what plays.
public sealed class Session
{
    Session(Api api, bool fixtures)
    {
        Api = api;
        Fixtures = fixtures;
        Covers = new Covers(api);
        Library = new Library(api);
        Now = new NowPlaying(this);
    }

    /// The window's session (ECHO has one window); CoverImage reads its covers.
    public static Session? Current { get; set; }

    /// The server refused the device token (revoked, or idle 60 days): back to sign-in.
    public event Action? SignedOut;

    public void Refused() => SignedOut?.Invoke();

    public Api Api { get; }
    /// The smoke run and the tests: Echo.Fixtures instead of a server.
    public bool Fixtures { get; }
    public Covers Covers { get; }
    public Library Library { get; }
    public Nav Nav { get; } = new();
    public AudioTap Tap { get; } = new();
    public NowPlaying Now { get; }

    public static Session ForServer(Api api) => new(api, fixtures: false);

    public static Session ForFixtures()
    {
        var s = new Session(new Api("https://fixtures.invalid"), fixtures: true);
        var album = Echo.Fixtures.Albums[10];
        s.Now.Show(album, album.Tracks, 0);
        return s;
    }

    public async Task<IReadOnlyList<Album>> Albums() => Fixtures ? Echo.Fixtures.Albums : await Library.AllAlbums(AlbumSort.AZ);

    /// The album with its tracks (a list's albums come without them).
    public async Task<Album?> Album(Album album) => Fixtures ? album : await Library.Album(album.Id);
}

/// What plays, until the Player (the queue, the saved queue, scrobbles) takes over: an album from a song on.
public sealed partial class NowPlaying(Session session) : ObservableObject
{
    AudioOut? output;
    IReadOnlyList<Track> songs = [];
    int index;
    readonly DispatcherTimer tick = new() { Interval = TimeSpan.FromMilliseconds(250) };

    [ObservableProperty] public partial Album? Album { get; private set; }
    [ObservableProperty] public partial Track? Track { get; private set; }
    [ObservableProperty] public partial bool Playing { get; private set; }
    /// 0…1 through the song.
    [ObservableProperty] public partial double Progress { get; private set; }
    [ObservableProperty] public partial string? Notice { get; private set; }

    AudioOut Output
    {
        get
        {
            if (output is not null) return output;
            output = new AudioOut(session.Tap);
            output.Ended += () => Dispatcher.UIThread.Post(() => _ = Next());
            tick.Tick += (_, _) => Progress = output.Duration > TimeSpan.Zero ? output.Position / output.Duration : 0;
            tick.Start();
            return output;
        }
    }

    /// Shows a song without playing it (the smoke run's pill).
    public void Show(Album album, IReadOnlyList<Track> list, int at)
    {
        Album = album;
        songs = list;
        index = at;
        Track = list[at];
    }

    public async Task Play(Album album, IReadOnlyList<Track> list, int at)
    {
        Show(album, list, at);
        if (session.Fixtures) return;
        try
        {
            Notice = null;
            await Output.Open(await session.Api.StreamUrl(list[at]));
            Output.Play();
            Playing = true;
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or IOException or InvalidOperationException)
        {
            Playing = false;
            Notice = "Can't play this song.";
        }
    }

    public void Toggle()
    {
        if (output is null || Track is null) return;
        if (Playing) output.Pause();
        else output.Play();
        Playing = !Playing;
    }

    public async Task Next()
    {
        if (Album is null || index + 1 >= songs.Count)
        {
            Playing = false; // the album stops after its last song
            return;
        }
        await Play(Album, songs, index + 1);
    }

    public async Task Previous()
    {
        if (Album is null) return;
        if (output is not null && output.Position > TimeSpan.FromSeconds(3) || index == 0) output?.Seek(TimeSpan.Zero);
        else await Play(Album, songs, index - 1);
    }
}
