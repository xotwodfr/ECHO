using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace Echo.Ui;

/// Your Library → Wanted (ACCEPTANCE_CRITERIA.md WNT-01): one list for everyone on the server of music
/// that isn't in Navidrome yet. What the library has plays; the rest links to YouTube Music.
public sealed class WantedView : UserControl
{
    readonly Session s;
    readonly Wanted wanted;
    readonly StackPanel list = new() { Spacing = 2 };
    readonly TextBlock status = Page.Note();
    readonly TextBox box;

    public WantedView(Session session)
    {
        s = session;
        wanted = new Wanted(s.Api);
        box = new TextBox { PlaceholderText = "Artist and song, or an album", Width = 380, Height = 36, VerticalContentAlignment = VerticalAlignment.Center, CornerRadius = new CornerRadius(18), Padding = new Thickness(14, 0) };
        var add = Page.Primary("Add", () => _ = Add());
        add.Margin = new Thickness(0);
        var column = new StackPanel
        {
            Children =
            {
                Page.Title("Your Library"),
                Page.LibraryTabs(s, new WantedPage()),
                new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(8, 0, 0, 16), Children = { box, add } },
                status,
                list,
            },
        };
        Content = Page.Scroll(column);
        _ = Page.Load(s, status, Load);
    }

    async Task Add()
    {
        if (string.IsNullOrWhiteSpace(box.Text)) return;
        await Page.Load(s, status, async () =>
        {
            await wanted.Add(box.Text);
            box.Text = "";
            s.Player.Notice = "Added to Wanted";
            await Load();
        });
    }

    async Task Load()
    {
        var items = await wanted.List();
        list.Children.Clear();
        if (items.Count == 0) list.Children.Add(Page.Note("Nothing wanted yet. Add music that isn’t in Navidrome here, or from a search that finds nothing."));
        foreach (var item in items) list.Children.Add(Row(item));
    }

    Control Row(WantedItem item)
    {
        var muted = (IBrush)Application.Current!.FindResource("Muted")!;
        var action = item.Found is { } f
            ? Tool($"Play {f.Title}", () => Open(f))
            : Tool("YouTube Music", () => _ = TopLevel.GetTopLevel(this)?.Launcher.LaunchUriAsync(new Uri($"https://music.youtube.com/search?q={Uri.EscapeDataString(item.Text)}")));
        var remove = Tool("✕", async () =>
        {
            await Page.Load(s, status, async () =>
            {
                await wanted.Remove(item.Id);
                await Load();
            });
        });
        ToolTip.SetTip(remove, $"Remove {item.Text} from Wanted");
        return new DockPanel
        {
            Margin = new Thickness(8, 4),
            Children =
            {
                new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, [DockPanel.DockProperty] = Dock.Right, VerticalAlignment = VerticalAlignment.Center, Children = { action, remove } },
                new StackPanel
                {
                    VerticalAlignment = VerticalAlignment.Center,
                    Children =
                    {
                        new TextBlock { Text = item.Text, FontSize = 14, TextTrimming = TextTrimming.CharacterEllipsis },
                        new TextBlock { Text = item.Found is null ? "Not in Navidrome yet" : "In your library", FontSize = 12, Foreground = muted },
                    },
                },
            },
        };
    }

    void Open(WantedFound f)
    {
        // An album opens; a song plays from its album.
        if (f.Kind == "album") s.Nav.Go(new AlbumPage(new Album(f.Id, f.Title, f.Artist)));
        else if (f.AlbumId is { } albumId) _ = PlaySong(albumId, f.Id);
    }

    async Task PlaySong(string albumId, string songId)
    {
        await Page.Load(s, status, async () =>
        {
            if (await s.Library.Album(albumId) is not { } album) return;
            var at = album.Tracks.ToList().FindIndex(t => t.Id == songId);
            await s.Player.PlayList(album.Tracks, Math.Max(0, at), new PlayContext("album", album.Id, album.Title));
        });
    }

    static Button Tool(string text, Action click)
    {
        var b = new Button { Theme = Page.Bare, Content = text, Padding = new Thickness(12, 6), CornerRadius = new CornerRadius(14), FontWeight = FontWeight.SemiBold, BorderBrush = new SolidColorBrush(Color.Parse("#33FFFFFF")), BorderThickness = new Thickness(1) };
        b.Click += (_, _) => click();
        return b;
    }
}
