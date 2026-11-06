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
        Player = new Player(api, Library, () => new AudioOut(Tap, nullDevice: fixtures)) { Sync = !fixtures };
        Player.SignedOut += Refused;
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
    public Player Player { get; }

    public static Session ForServer(Api api) => new(api, fixtures: false);

    public static Session ForFixtures()
    {
        var s = new Session(new Api("https://fixtures.invalid"), fixtures: true);
        var album = Echo.Fixtures.Albums[10];
        s.Player.Show(new QueueState(Now: album.Tracks[0], Context: album.Tracks.Skip(1).ToList(),
            ContextSource: new PlayContext("album", album.Id, album.Title)), TimeSpan.FromSeconds(78));
        return s;
    }

    public async Task<IReadOnlyList<Album>> Albums() => Fixtures ? Echo.Fixtures.Albums : await Library.AllAlbums(AlbumSort.AZ);

    /// The album with its tracks (a list's albums come without them).
    public async Task<Album?> Album(Album album) => Fixtures ? album : await Library.Album(album.Id);
}
