using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Controls.Primitives;

namespace Echo.Ui;

/// Cider's main window (views/main.ejs, #app-main), in the layout Settings chose: Mojave, Cider's default
/// (the top chrome over the sidebar and the page, the bottom chrome under it all), or Maverick (the player
/// in the top chrome, no bottom chrome); the drawer floats at the right in both. The sidebar and the bars
/// lie on #app-main's translucent ground; the page floats over it as a card.
public sealed class Shell : Grid
{
    readonly Session session;
    readonly ContentControl page = new();
    readonly Sidebar sidebar;

    public Shell(Session session)
    {
        this.session = session;
        Nav = new Nav();
        Maverick = session.Prefs.Layout == "maverick";
        Background = Kit.Brush("AppMain");
        RowDefinitions = new RowDefinitions(Maverick ? "*" : $"*,{ChromeBottom.Height2}");

        Top = new ChromeTop(Nav, Maverick ? session : null);
        sidebar = new Sidebar(session, Nav, Maverick);
        Bottom = new ChromeBottom(session, Nav);
        Tools = Maverick ? Top.Tools! : Bottom.Tools;

        var navigation = new Grid
        {
            RowDefinitions = new RowDefinitions($"{Top.Height},*"),
            ColumnDefinitions = new ColumnDefinitions("Auto,*"),
        };
        navigation.Children.Add(new Border { [Grid.ColumnSpanProperty] = 2, Child = Top });
        navigation.Children.Add(new Border { [Grid.RowProperty] = 1, Child = sidebar });
        // #app-content as today's apps float it: a rounded card on the ground, 8 px from the window's edges.
        var card = new Border
        {
            [Grid.RowProperty] = 1,
            [Grid.ColumnProperty] = 1,
            Background = Kit.Brush("Card"),
            BorderBrush = Kit.Brush("Hairline"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(10),
            Margin = new Thickness(0, 0, 8, Maverick ? 8 : 0),
            ClipToBounds = true,
            Child = page,
        };
        navigation.Children.Add(card);
        Drawer = new Drawer(session, Nav) { [Grid.RowProperty] = 1, [Grid.ColumnProperty] = 1 };
        navigation.Children.Add(Drawer);
        Children.Add(navigation);
        if (!Maverick) Children.Add(new Border { [Grid.RowProperty] = 1, Child = Bottom });
        // Cider's modals (Settings) float over everything.
        modal.SetValue(Grid.RowSpanProperty, 2);
        Children.Add(modal);

        Top.SidebarToggled += () =>
        {
            sidebar.IsVisible = !sidebar.IsVisible;
            card.Margin = new Thickness(sidebar.IsVisible ? 0 : 8, 0, 8, card.Margin.Bottom);
        };
        Top.MenuRequested += anchor => MainMenu.Show(anchor, session, () => ShowSettings(), () => ShowSettings("About"));
        Tools.DrawerRequested += Drawer.Toggle;
        Drawer.Changed += () => Tools.OpenPanel = Drawer.Panel;
        Top.Searched += Search;
        sidebar.Searched += Search;
        Bottom.ArtworkClicked += ShowNowPlaying;
        Bottom.MenuRequested += anchor => NowPlayingMenu.Show(anchor, session, Nav);
        if (Top.Lcd is { } lcd)
        {
            lcd.ArtworkClicked += ShowNowPlaying;
            lcd.MenuRequested += anchor => NowPlayingMenu.Show(anchor, session, Nav);
        }
        Nav.Changed += Show;
        Show();
    }

    readonly Panel modal = new() { IsVisible = false };

    /// Maverick: the player in the top chrome, no bottom chrome.
    public bool Maverick { get; }
    /// The volume, queue and lyrics buttons, wherever the layout has them.
    public BarTools Tools { get; }

    void Search(string term) => Nav.Open(new Route("search", term, term));

    /// Today's keys (the window passes on what nothing else took): Ctrl+F goes to the search field, Space
    /// plays or pauses unless a field has the keyboard.
    public void Keys(Avalonia.Input.KeyEventArgs e)
    {
        if (e.Key == Avalonia.Input.Key.F && e.KeyModifiers == Avalonia.Input.KeyModifiers.Control)
            e.Handled = Top.FocusSearch() || sidebar.FocusSearch();
        else if (e.Key == Avalonia.Input.Key.Space && e.KeyModifiers == Avalonia.Input.KeyModifiers.None && e.Source is not TextBox)
        {
            session.Player.Toggle();
            e.Handled = true;
        }
    }

    /// Cider's settings window over the app, 90 % of it up to 980×680, the app dimmed behind it; a click
    /// on the dimmed app closes it.
    public SettingsWindow ShowSettings(string tab = "General")
    {
        var window = new SettingsWindow(session, tab);
        window.Closed += () =>
        {
            modal.Children.Clear();
            modal.IsVisible = false;
        };
        var scrim = new Border { Background = new SolidColorBrush(Color.FromArgb(140, 0, 0, 0)) };
        scrim.PointerPressed += (_, _) => window.Close();
        modal.Children.Clear();
        modal.Children.Add(scrim);
        window.Width = Math.Min(Bounds.Width * 0.9, 980);
        window.Height = Math.Min(Bounds.Height * 0.9, 680);
        modal.Children.Add(window);
        modal.IsVisible = true;
        Motion.Enter(window);
        return window;
    }

    /// The settings window on show, or null (tests read it).
    public SettingsWindow? Settings => modal.Children.OfType<SettingsWindow>().FirstOrDefault();

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
            b.FontWeight = FontWeight.Medium;
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

    /// A page comes in as Cider's do (wpfade): from 12 px lower and transparent, in 260 ms.
    void Show()
    {
        var next = Pages.Create(session, Nav, Nav.Current);
        page.Content = next;
        Motion.Enter(next);
    }
}
