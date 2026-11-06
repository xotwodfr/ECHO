using Echo.Playback;

namespace Echo.Ui;

/// Everything one signed-in window shares: the server (or the built-in Fixtures), covers, the library,
/// what plays and its lyrics.
public sealed class Session
{
    public Session(Api api, bool fixtures = false)
    {
        Api = api;
        IsFixtures = fixtures;
        Covers = new Covers(api);
        Library = new Library(api);
        Player = new Player(api, Library, () => new AudioOut(nullDevice: fixtures));
        Player.SignedOut += () => SignedOut?.Invoke();
        Lyrics = new Lyrics(api);
        Lyrics.Follow(Player);
    }

    /// The window's session (ECHO has one window); CoverImage reads its covers.
    public static Session? Current { get; set; }

    /// The smoke run and the screenshots: the built-in library, its queue shown paused at 1:18.
    public static Session ForFixtures()
    {
        var s = new Session(new Api(Fixtures.Base, new Fixtures()), fixtures: true);
        _ = s.Player.Restore();
        return s;
    }

    /// The server refused the device token: back to sign-in.
    public event Action? SignedOut;

    public Api Api { get; }
    public bool IsFixtures { get; }
    public Covers Covers { get; }
    public Library Library { get; }
    public Player Player { get; }
    public Lyrics Lyrics { get; }
}
