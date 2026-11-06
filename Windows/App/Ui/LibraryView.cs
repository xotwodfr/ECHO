using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Echo.Playback;

namespace Echo.Ui;

/// The baseline's one screen: the albums A–Z on the left, the open album's songs on the right (a song
/// plays the album from there on), and the player along the bottom with sign out.
public sealed class LibraryView : DockPanel
{
    readonly Player player;
    readonly Library library;
    readonly ListBox albums = new();
    readonly ListBox songs = new();
    readonly TextBlock heading = new() { FontSize = 28, FontWeight = FontWeight.Bold, Margin = new Thickness(16, 16, 16, 8), TextTrimming = TextTrimming.CharacterEllipsis };
    readonly TextBlock status = new() { Margin = new Thickness(16, 4), Opacity = 0.6, IsVisible = false };
    readonly TextBlock nowTitle = new() { FontWeight = FontWeight.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis };
    readonly TextBlock nowArtist = new() { Opacity = 0.6, FontSize = 12, TextTrimming = TextTrimming.CharacterEllipsis };
    readonly TextBlock time = new() { Opacity = 0.6, FontSize = 12, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0) };
    readonly Button toggle = new() { Content = "Play", Width = 72 };
    IReadOnlyList<Track> tracks = [];

    public LibraryView(Session session)
    {
        player = session.Player;
        library = session.Library;

        var signOut = new Button { Content = "Sign out", Margin = new Thickness(12, 0, 0, 0) };
        signOut.Click += (_, _) => _ = player.SignOut();
        var previous = new Button { Content = "Previous" };
        previous.Click += (_, _) => _ = player.Previous();
        var next = new Button { Content = "Next" };
        next.Click += (_, _) => _ = player.Next();
        toggle.Click += (_, _) => player.Toggle();
        DockPanel.SetDock(time, Dock.Right);
        var bar = new DockPanel
        {
            Margin = new Thickness(12),
            Children =
            {
                new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, [DockPanel.DockProperty] = Dock.Right, Children = { previous, toggle, next, signOut } },
                time,
                new StackPanel { VerticalAlignment = VerticalAlignment.Center, Children = { nowTitle, nowArtist } },
            },
        };
        Children.Add(new Border { BorderBrush = new SolidColorBrush(Color.Parse("#22FFFFFF")), BorderThickness = new Thickness(0, 1, 0, 0), Child = bar, [DockProperty] = Dock.Bottom });

        albums.Width = 320;
        albums.Background = songs.Background = Brushes.Transparent;
        albums.ItemTemplate = new Avalonia.Controls.Templates.FuncDataTemplate<Album>((a, _) => new StackPanel
        {
            Margin = new Thickness(4, 2),
            Children =
            {
                new TextBlock { Text = a?.Title, FontWeight = FontWeight.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis },
                new TextBlock { Text = a?.Artist, FontSize = 12, Opacity = 0.6, TextTrimming = TextTrimming.CharacterEllipsis },
            },
        });
        albums.SelectionChanged += (_, _) => { if (albums.SelectedItem is Album a) _ = Open(a); };
        Children.Add(new Border { BorderBrush = new SolidColorBrush(Color.Parse("#22FFFFFF")), BorderThickness = new Thickness(0, 0, 1, 0), Child = albums, [DockProperty] = Dock.Left });

        songs.ItemTemplate = new Avalonia.Controls.Templates.FuncDataTemplate<Track>((t, _) => new DockPanel
        {
            Margin = new Thickness(4, 2),
            Children =
            {
                new TextBlock { Text = t is null ? "" : $"{t.DurationMs / 60_000}:{t.DurationMs / 1000 % 60:00}", Opacity = 0.6, [DockPanel.DockProperty] = Dock.Right },
                new TextBlock { Text = t?.Title, TextTrimming = TextTrimming.CharacterEllipsis },
            },
        });
        songs.DoubleTapped += (_, _) => { if (songs.SelectedIndex >= 0) _ = player.PlayList(tracks, songs.SelectedIndex, new PlayContext("album", null, heading.Text ?? "")); };
        DockPanel.SetDock(heading, Dock.Top);
        DockPanel.SetDock(status, Dock.Top);
        Children.Add(new DockPanel { Children = { heading, status, songs } });

        player.PropertyChanged += (_, _) => Show();
        Show();
        _ = Load();
    }

    async Task Load()
    {
        try
        {
            albums.ItemsSource = await library.AllAlbums(AlbumSort.AZ);
            heading.Text = "Pick an album";
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException)
        {
            Say(e is ApiException { SignedOut: true } ? "You were signed out." : "Can't reach the server.");
            if (e is ApiException { SignedOut: true }) await player.SignOut();
        }
    }

    async Task Open(Album album)
    {
        heading.Text = album.Title;
        status.IsVisible = false;
        try
        {
            tracks = (await library.Album(album.Id))?.Tracks ?? [];
            songs.ItemsSource = tracks;
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException)
        {
            Say("Can't reach the server.");
        }
    }

    void Say(string text)
    {
        status.Text = text;
        status.IsVisible = true;
    }

    void Show()
    {
        nowTitle.Text = player.Track?.Title ?? player.Notice ?? "Nothing playing";
        nowArtist.Text = player.Track?.Artist;
        toggle.Content = player.Playing ? "Pause" : "Play";
        static string M(TimeSpan t) => $"{(int)t.TotalMinutes}:{t.Seconds:00}";
        time.Text = player.Track is null ? "" : $"{M(player.Position)} / {M(player.Duration)}";
    }
}
