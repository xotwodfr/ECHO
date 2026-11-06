using Echo.Playback;
using Echo.Stage.Lyrics;

namespace Echo.Ui;

/// Everything one signed-in window shares: the server (or the built-in fixtures), covers, where the
/// shell is, and what plays.
public sealed class Session
{
    Session(Api api, bool fixtures)
    {
        Api = api;
        Fixtures = fixtures;
        Prefs = new PrefsStore(fixtures ? null : PrefsStore.DefaultFile);
        Covers = new Covers(api);
        Library = new Library(api);
        Player = new Player(api, Library, () => new AudioOut(Tap, nullDevice: fixtures)) { Sync = !fixtures, Scrobble = Prefs.State.Scrobble };
        Prefs.Changed += p => Player.Scrobble = p.Scrobble;
        Player.SignedOut += Refused;
        Lyrics = new Lyrics(api);
        if (!fixtures) Lyrics.Follow(Player);
    }

    /// The window's session (ECHO has one window); CoverImage reads its covers.
    public static Session? Current { get; set; }

    /// The server refused the device token (revoked, or idle 60 days): back to sign-in.
    public event Action? SignedOut;

    public void Refused() => SignedOut?.Invoke();

    /// The queue sheet opens or closes (the pill's queue button, Q).
    public event Action? QueueToggled;

    public void ToggleQueue() => QueueToggled?.Invoke();

    public Api Api { get; }
    /// The smoke run and the tests: Echo.Fixtures instead of a server.
    public bool Fixtures { get; }
    public Covers Covers { get; }
    public Library Library { get; }
    public Nav Nav { get; } = new();
    public AudioTap Tap { get; } = new();
    public Player Player { get; }
    public PrefsStore Prefs { get; }
    public Lyrics Lyrics { get; }

    public static Session ForServer(Api api) => new(api, fixtures: false);

    public static Session ForFixtures()
    {
        var s = new Session(new Api("https://fixtures.invalid"), fixtures: true);
        var album = Echo.Fixtures.Albums[10];
        s.Player.Show(new QueueState(Now: album.Tracks[0], Context: album.Tracks.Skip(1).ToList(),
            ContextSource: new PlayContext("album", album.Id, album.Title)), TimeSpan.FromSeconds(78));
        return s;
    }

    // The calls the smoke run's pages make, answered from the fixtures there.

    public async Task<IReadOnlyList<Album>> Albums(AlbumSort sort) => Fixtures ? Echo.Fixtures.Albums : await Library.AllAlbums(sort);

    public async Task<IReadOnlyList<Album>> Shelf(AlbumList kind) =>
        Fixtures ? Echo.Fixtures.Albums.Skip((int)kind * 3).Concat(Echo.Fixtures.Albums).Take(6).ToList() : await Library.AlbumList(kind, 12);

    public async Task<IReadOnlyList<Playlist>> Playlists() => Fixtures ? [] : await Library.Playlists();

    public async Task<IReadOnlyList<Mix>> Mixes() => Fixtures ? [] : await Library.Mixes();

    public async Task<IReadOnlyList<PlayedContext>> PlayedContexts() => Fixtures ? [] : await Library.PlayedContexts();

    /// The album with its tracks (a list's albums come without them).
    public async Task<Album?> Album(Album album) => Fixtures ? album : await Library.Album(album.Id);
}
