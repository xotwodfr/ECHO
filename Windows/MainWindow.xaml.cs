using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace Echo;

/// A list row: the title, bold, over a dimmer line.
public record Row(string Title, string Sub);

/// The baseline every native client has (README.md): sign in, the albums, an album's songs, and a
/// player that goes on through the album.
public partial class MainWindow : Window
{
    /// The owner's server (as the Android app's); ECHO_URL points a test build elsewhere.
    readonly Api api = new(Environment.GetEnvironmentVariable("ECHO_URL") ?? "https://echo.folk3s.com");
    readonly MediaPlayer player = new();
    readonly DispatcherTimer clock = new() { Interval = TimeSpan.FromSeconds(1) };
    List<Album> albums = [];
    List<Song> shown = [];
    List<Song> queue = [];
    int current;
    bool playing;

    public MainWindow()
    {
        InitializeComponent();
        ServerText.Text = api.Base;
        player.MediaEnded += (_, _) => Next();
        player.MediaFailed += (_, e) =>
        {
            SetPlaying(false);
            ShowStatus($"This song could not play: {e.ErrorException.Message}");
        };
        clock.Tick += (_, _) =>
        {
            if (playing && current < queue.Count)
                TimeText.Text = $"{Mmss(player.Position)} / {Mmss(TimeSpan.FromSeconds(queue[current].Seconds))}";
        };
        clock.Start();
        api.Token = TokenStore.Load();
        if (api.Token is null) ShowSignIn("");
        else _ = LoadAlbums();
    }

    static string Mmss(TimeSpan t) => $"{(int)t.TotalMinutes}:{t.Seconds:00}";

    void ShowStatus(string text)
    {
        Status.Text = text;
        Status.Visibility = text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    void SetPlaying(bool on)
    {
        playing = on;
        ToggleButton.Content = on ? "Pause" : "Play";
    }

    /// Signed out here, or the server refused the token (revoked in Sessions & devices, or idle 60 days).
    void ShowSignIn(string why)
    {
        TokenStore.Forget();
        api.Token = null;
        player.Stop();
        SetPlaying(false);
        NowBar.Visibility = Visibility.Collapsed;
        TopBar.Visibility = Visibility.Collapsed;
        AlbumList.Visibility = Visibility.Collapsed;
        SongList.Visibility = Visibility.Collapsed;
        SignInPage.Visibility = Visibility.Visible;
        SignInMessage.Text = why;
        ShowStatus("");
    }

    void Failed(Exception e)
    {
        if (e is ApiException { SignedOut: true }) ShowSignIn("Signed out. Sign in again.");
        else ShowStatus($"ECHO did not answer: {e.Message}");
    }

    async void SignIn_Click(object sender, RoutedEventArgs e)
    {
        SignInMessage.Text = "Signing in…";
        SignInButton.IsEnabled = false;
        try
        {
            var name = $"ECHO for Windows ({Environment.MachineName})";
            api.Token = await api.SignIn(UserBox.Text.Trim(), PassBox.Password, CodeBox.Text, name[..Math.Min(64, name.Length)]);
            TokenStore.Save(api.Token);
            PassBox.Clear();
            CodeBox.Clear();
            SignInMessage.Text = "";
            await LoadAlbums();
        }
        catch (ApiException x)
        {
            SignInMessage.Text = x.Code switch
            {
                "totp_required" => "Enter the code from your authenticator app too.",
                "bad_code" => "That code did not work. Try the next one.",
                "rate_limited" => "Too many attempts. Wait a minute and try again.",
                _ when x.SignedOut => "Username or password is incorrect.",
                _ => $"ECHO did not answer: {x.Message}",
            };
        }
        catch (HttpRequestException x)
        {
            SignInMessage.Text = $"ECHO could not be reached: {x.Message}";
        }
        finally
        {
            SignInButton.IsEnabled = true;
        }
    }

    void ShowAlbums()
    {
        SignInPage.Visibility = Visibility.Collapsed;
        SongList.Visibility = Visibility.Collapsed;
        AlbumList.Visibility = Visibility.Visible;
        TopBar.Visibility = Visibility.Visible;
        BackButton.Visibility = Visibility.Collapsed;
        PageTitle.Text = "Albums";
    }

    async Task LoadAlbums()
    {
        ShowAlbums();
        ShowStatus("Loading your albums…");
        try
        {
            albums = await api.Albums();
            AlbumList.ItemsSource = albums.Select(a => new Row(a.Name, a.Artist)).ToList();
            ShowStatus(albums.Count == 0 ? "No albums yet: connect Navidrome in ECHO's Settings." : "");
        }
        catch (Exception x) when (x is ApiException or HttpRequestException or TaskCanceledException)
        {
            Failed(x);
        }
    }

    async void AlbumList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (AlbumList.SelectedIndex < 0) return;
        var album = albums[AlbumList.SelectedIndex];
        AlbumList.SelectedIndex = -1; // the same album opens again after Back
        try
        {
            shown = await api.Songs(album.Id);
            SongList.ItemsSource = shown
                .Select((s, i) => new Row($"{i + 1}. {s.Title}", $"{s.Artist} · {Mmss(TimeSpan.FromSeconds(s.Seconds))}"))
                .ToList();
            PageTitle.Text = album.Name;
            BackButton.Visibility = Visibility.Visible;
            AlbumList.Visibility = Visibility.Collapsed;
            SongList.Visibility = Visibility.Visible;
        }
        catch (Exception x) when (x is ApiException or HttpRequestException or TaskCanceledException)
        {
            Failed(x);
        }
    }

    async void SongList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (SongList.SelectedIndex < 0) return;
        queue = shown.ToList();
        await PlayAt(SongList.SelectedIndex);
    }

    async Task PlayAt(int index)
    {
        current = index;
        var song = queue[index];
        NowText.Text = $"{song.Title} — {song.Artist}";
        TimeText.Text = $"0:00 / {Mmss(TimeSpan.FromSeconds(song.Seconds))}";
        NowBar.Visibility = Visibility.Visible;
        ShowStatus("");
        try
        {
            var url = await api.StreamUrl(song);
            if (current != index) return; // a newer tap won meanwhile
            player.Open(new Uri(url));
            player.Play();
            SetPlaying(true);
        }
        catch (Exception x) when (x is ApiException or HttpRequestException or TaskCanceledException)
        {
            Failed(x);
        }
    }

    /// The album goes on; after its last song the player stops.
    void Next()
    {
        if (current + 1 < queue.Count) _ = PlayAt(current + 1);
        else SetPlaying(false);
    }

    void Toggle_Click(object sender, RoutedEventArgs e)
    {
        if (playing) player.Pause();
        else player.Play();
        SetPlaying(!playing);
    }

    void Back_Click(object sender, RoutedEventArgs e) => ShowAlbums();

    async void SignOut_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await api.SignOut(); // this device leaves Sessions & devices on the server
        }
        catch (Exception x) when (x is ApiException or HttpRequestException or TaskCanceledException) { }
        ShowSignIn("");
    }
}
