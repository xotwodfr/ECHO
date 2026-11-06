using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Styling;

namespace Echo.Ui;

/// A cover card: an album, an artist (round), a playlist, a mix.
public sealed record Card(string Title, string? Subtitle, string? Cover, Action Open, bool Round = false);

/// What the library pages share: the page's column (clear of the sidebar and the pill, which float
/// over its edges), titles, sections, cover cards, the library's tabs, and loading with its states.
static class Page
{
    public static ControlTheme Bare => (ControlTheme)Application.Current!.FindResource("Bare")!;
    static IBrush Muted => (IBrush)Application.Current!.FindResource("Muted")!;

    public static ScrollViewer Scroll(StackPanel column)
    {
        column.Margin = new Thickness(228, 72, 24, 110);
        column.Spacing = 4;
        return new ScrollViewer { Content = column };
    }

    public static TextBlock Title(string text) => new()
    {
        Text = text, FontSize = 44, FontWeight = FontWeight.Bold, LetterSpacing = -0.9, Margin = new Thickness(8, 0, 0, 16),
        TextTrimming = TextTrimming.CharacterEllipsis,
    };

    public static TextBlock Heading(string text) => new()
    {
        Text = text, FontSize = 22, FontWeight = FontWeight.Bold, Margin = new Thickness(8, 28, 0, 10),
    };

    public static TextBlock Note(string text = "") => new() { Text = text, Foreground = Muted, Margin = new Thickness(8, 4), IsVisible = text.Length > 0 };

    public static Button Primary(string text, Action click)
    {
        var b = new Button
        {
            Content = text, Height = 36, Padding = new Thickness(20, 0), CornerRadius = new CornerRadius(18), FontWeight = FontWeight.SemiBold,
            Background = (IBrush)Application.Current!.FindResource("Text")!, Foreground = (IBrush)Application.Current!.FindResource("Ground")!,
            Margin = new Thickness(8, 0, 0, 8), HorizontalAlignment = HorizontalAlignment.Left, VerticalContentAlignment = VerticalAlignment.Center,
        };
        b.Click += (_, _) => click();
        return b;
    }

    /// Cover cards in rows that wrap; a shelf (`max` given) is one row, as many as fit, at most `max`.
    public static Control Cards(IEnumerable<Card> cards, int max = int.MaxValue)
    {
        var wrap = new WrapPanel { ItemWidth = 196 };
        if (max != int.MaxValue)
        {
            wrap.MaxHeight = 236; // one card
            wrap.ClipToBounds = true;
        }
        foreach (var c in cards.Take(max)) wrap.Children.Add(CardView(c));
        return wrap;
    }

    static Button CardView(Card c)
    {
        var radius = c.Round ? 86 : 8;
        var b = new Button
        {
            Theme = Bare, CornerRadius = new CornerRadius(12), Padding = new Thickness(8), Margin = new Thickness(0, 0, 0, 6),
            Content = new StackPanel
            {
                Width = 172,
                Children =
                {
                    new Border
                    {
                        Width = 172, Height = 172, CornerRadius = new CornerRadius(radius), ClipToBounds = true,
                        Background = (IBrush)Application.Current!.FindResource("Surface1")!,
                        Child = new CoverImage { Url = c.Cover, Pixels = 344, Fallback = c.Title },
                    },
                    new TextBlock { Text = c.Title, FontSize = 13, FontWeight = FontWeight.SemiBold, Margin = new Thickness(0, 9, 0, 1), TextTrimming = TextTrimming.CharacterEllipsis, HorizontalAlignment = c.Round ? HorizontalAlignment.Center : HorizontalAlignment.Left },
                    new TextBlock { Text = c.Subtitle ?? "", FontSize = 12, Foreground = Muted, TextTrimming = TextTrimming.CharacterEllipsis, IsVisible = c.Subtitle is { Length: > 0 }, HorizontalAlignment = c.Round ? HorizontalAlignment.Center : HorizontalAlignment.Left },
                },
            },
        };
        b.Click += (_, _) => c.Open();
        return b;
    }

    public static Card AlbumCard(Session s, Album a) => new(a.Title, a.Artist, a.Cover, () => s.Nav.Go(new AlbumPage(a)));

    /// Your Library's tabs, the current one lit.
    public static Control LibraryTabs(Session s, object current)
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(8, 0, 0, 18) };
        foreach (var (label, page) in new (string, object)[]
                 {
                     ("Albums", new AlbumsPage()), ("Artists", new ArtistsPage()), ("Playlists", new PlaylistsPage()),
                     ("Liked Songs", new StarredPage()), ("Wanted", new WantedPage()),
                 })
        {
            var on = page.GetType() == current.GetType();
            var b = new Button
            {
                Theme = Bare, Content = label, Padding = new Thickness(14, 6), CornerRadius = new CornerRadius(16), FontSize = 13,
                FontWeight = FontWeight.SemiBold, Background = on ? new SolidColorBrush(Color.Parse("#2EFFFFFF")) : Brushes.Transparent,
                BorderBrush = new SolidColorBrush(Color.Parse("#33FFFFFF")), BorderThickness = new Thickness(1),
            };
            b.Click += (_, _) => s.Nav.Go(page);
            row.Children.Add(b);
        }
        return row;
    }

    /// Runs a page's load: a refused token signs out; no server says so in `status`.
    public static async Task Load(Session s, TextBlock status, Func<Task> load)
    {
        // Loading (F11's designed states): said only when it takes a moment.
        var done = false;
        Avalonia.Threading.DispatcherTimer.RunOnce(() =>
        {
            if (done) return;
            status.Text = "Loading…";
            status.IsVisible = true;
        }, TimeSpan.FromMilliseconds(300));
        try
        {
            await load();
            done = true;
            if (status.Text == "Loading…") status.IsVisible = false;
        }
        catch (ApiException e) when (e.SignedOut)
        {
            s.Refused();
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException)
        {
            status.Text = "Can't reach the server.";
            status.IsVisible = true;
        }
        finally
        {
            done = true;
        }
    }
}

/// Songs as rows: number, cover, title and artist, album, time. A click plays the list from that song;
/// the menu has Play next, Add to queue, the album, the artist and Like.
public sealed class TrackList : StackPanel
{
    public TrackList(Session s, IReadOnlyList<Track> tracks, PlayContext context, bool covers = true)
    {
        Spacing = 0;
        var muted = (IBrush)Application.Current!.FindResource("Muted")!;
        for (var i = 0; i < tracks.Count; i++)
        {
            var t = tracks[i];
            var index = i;
            var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("36,Auto,2*,*,Auto") };
            grid.Children.Add(new TextBlock { Text = $"{i + 1}", Foreground = muted, FontSize = 13, VerticalAlignment = VerticalAlignment.Center });
            if (covers)
                grid.Children.Add(new Border
                {
                    Width = 40, Height = 40, CornerRadius = new CornerRadius(4), ClipToBounds = true, Margin = new Thickness(0, 0, 12, 0),
                    Child = new CoverImage { Url = t.Cover, Pixels = 80, Fallback = t.Album.Title }, [Grid.ColumnProperty] = 1,
                });
            grid.Children.Add(new StackPanel
            {
                [Grid.ColumnProperty] = 2, VerticalAlignment = VerticalAlignment.Center,
                Children =
                {
                    new TextBlock { Text = t.Title, FontSize = 14, TextTrimming = TextTrimming.CharacterEllipsis },
                    new TextBlock { Text = t.Artist, FontSize = 12, Foreground = muted, TextTrimming = TextTrimming.CharacterEllipsis },
                },
            });
            grid.Children.Add(new TextBlock { Text = t.Album.Title, FontSize = 13, Foreground = muted, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0), [Grid.ColumnProperty] = 3 });
            grid.Children.Add(new TextBlock { Text = $"{t.DurationMs / 60_000}:{t.DurationMs / 1000 % 60:00}", FontSize = 13, Foreground = muted, VerticalAlignment = VerticalAlignment.Center, [Grid.ColumnProperty] = 4 });
            var row = new Button
            {
                Theme = Page.Bare, CornerRadius = new CornerRadius(8), Padding = new Thickness(12, 7), HorizontalAlignment = HorizontalAlignment.Stretch,
                HorizontalContentAlignment = HorizontalAlignment.Stretch, Content = grid, ContextMenu = Menus.TrackMenu(s, t),
            };
            row.Click += (_, _) => _ = s.Player.PlayList(tracks, index, context);
            Children.Add(row);
        }
    }
}
