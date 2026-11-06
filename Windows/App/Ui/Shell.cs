using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Controls.Primitives;

namespace Echo.Ui;

/// Cider's main window in its default layout, Mojave (views/main.ejs, #app-main): the top chrome over the
/// sidebar and the page, the drawer floating at the right, the bottom chrome under it all. The layers are
/// Cider's translucent ones: #app-main, then --color1 behind the navigation, the sidebar and the page.
public sealed class Shell : Grid
{
    readonly Session session;
    readonly ContentControl page = new();
    readonly Sidebar sidebar;

    public Shell(Session session)
    {
        this.session = session;
        Nav = new Nav();
        Background = Kit.Brush("AppMain");
        RowDefinitions = new RowDefinitions($"*,{ChromeBottom.Height2}");

        Top = new ChromeTop(Nav);
        sidebar = new Sidebar(session, Nav);
        Bottom = new ChromeBottom(session, Nav);

        var navigation = new Grid
        {
            Background = new SolidColorBrush(Color.Parse("#80272727")),
            RowDefinitions = new RowDefinitions($"{ChromeTop.Height1},*"),
            ColumnDefinitions = new ColumnDefinitions("Auto,*"),
        };
        navigation.Children.Add(new Border { [Grid.ColumnSpanProperty] = 2, Child = Top });
        navigation.Children.Add(new Border { [Grid.RowProperty] = 1, Child = sidebar });
        // #app-content: --baseColorMix with a 1 px edge of it on the left.
        navigation.Children.Add(new Border
        {
            [Grid.RowProperty] = 1,
            [Grid.ColumnProperty] = 1,
            Background = Kit.Brush("Base"),
            BorderBrush = Kit.Brush("Base"),
            BorderThickness = new Thickness(1, 0, 0, 0),
            ClipToBounds = true,
            Child = page,
        });
        Drawer = new Drawer(session, Nav) { [Grid.RowProperty] = 1, [Grid.ColumnProperty] = 1 };
        navigation.Children.Add(Drawer);
        Children.Add(navigation);
        Children.Add(new Border { [Grid.RowProperty] = 1, Child = Bottom });

        Top.SidebarToggled += () => sidebar.IsVisible = !sidebar.IsVisible;
        Bottom.DrawerRequested += Drawer.Toggle;
        Drawer.Changed += () => Bottom.OpenPanel = Drawer.Panel;
        Top.Searched += term => Nav.Open(new Route("search", term, term));
        Bottom.ArtworkClicked += ShowNowPlaying;
        Nav.Changed += Show;
        Show();
    }

    public Nav Nav { get; }
    public ChromeTop Top { get; }
    public ChromeBottom Bottom { get; }
    public Drawer Drawer { get; }

    /// The artwork popover's two buttons (Cider's mediainfo-popover); the window changes mode.
    public event Action? FullscreenRequested;
    public event Action? MiniRequested;

    /// Cider's popover on the bar's artwork: the cover large, the song, artist and album, then Mini
    /// Player and Fullscreen View.
    void ShowNowPlaying(Control anchor)
    {
        if (session.Player.Track is not { } t) return;
        var flyout = new Flyout { Placement = PlacementMode.TopEdgeAlignedLeft };
        var mini = Kit.CiderButton("Mini Player", null, () =>
        {
            flyout.Hide();
            MiniRequested?.Invoke();
        });
        var full = Kit.CiderButton("Fullscreen View", null, () =>
        {
            flyout.Hide();
            FullscreenRequested?.Invoke();
        });
        var buttons = new Grid { ColumnDefinitions = new ColumnDefinitions("*,6,*") };
        foreach (var b in new[] { mini, full })
        {
            b.Padding = new Thickness(8, 6);
            b.FontSize = 13;
            b.HorizontalAlignment = HorizontalAlignment.Stretch;
        }
        buttons.Children.Add(mini);
        buttons.Children.Add(new Border { [Grid.ColumnProperty] = 2, Child = full });
        var name = Kit.Text(t.Title, 16, FontWeight.SemiBold);
        var artist = Kit.Text(t.Artist, 14, opacity: 0.8);
        var album = Kit.Text(t.Album.Title, 14, opacity: 0.8);
        flyout.Content = new StackPanel
        {
            Width = 240,
            Spacing = 4,
            Children =
            {
                new CoverImage(t.Cover, 240, 600) { Margin = new Thickness(0, 0, 0, 8) },
                name, artist, album,
                new Border { Height = 1, Background = new SolidColorBrush(Color.FromArgb(51, 255, 255, 255)), Margin = new Thickness(0, 8) },
                buttons,
            },
        };
        flyout.ShowAt(anchor);
    }

    /// The page on show (tests read it).
    public Control? Page => page.Content as Control;

    void Show() => page.Content = Pages.Create(session, Nav, Nav.Current);
}
