using System.Reflection;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Styling;

namespace Echo.Ui;

/// Cider's main menu (views/app/app-navigation.ejs .usermenu-container; style.less #cmenu): under the menu
/// button, 260 px with 10 px round it; the body rgb(30 30 30) (under Cider's glass), 6 px in, radius 10;
/// first the user, then the items at 15 px, 8 px 12 px, radius 6, --selected on hover. ECHO's items are
/// Settings, About, Sign Out and Quit (Cider's Web Remote, Cast, Audio Settings and Plugins are its own or
/// Apple Music's).
public static class MainMenu
{
    public static void Show(Control anchor, Session session, Action settings, Action about)
    {
        var flyout = new Flyout { Placement = PlacementMode.BottomEdgeAlignedLeft, FlyoutPresenterClasses = { "cider" } };
        var body = new StackPanel();
        var user = new TextBlock { Text = "", FontSize = 14, FontWeight = FontWeight.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis };
        var host = new TextBlock { Text = new Uri(session.Api.Base).Host, FontSize = 12, Opacity = 0.7, TextTrimming = TextTrimming.CharacterEllipsis };
        var me = Item(new Image { Source = Logo(), Width = 26, Height = 26 }, new StackPanel { Children = { user, host } }, () =>
        {
            flyout.Hide();
            settings();
        });
        body.Children.Add(me);
        body.Children.Add(Item(Icons.Settings, "Settings", () =>
        {
            flyout.Hide();
            settings();
        }));
        body.Children.Add(Item(Icons.Info, "About", () =>
        {
            flyout.Hide();
            about();
        }));
        body.Children.Add(Item(Icons.LogOut, "Sign Out", () =>
        {
            flyout.Hide();
            _ = session.Player.SignOut();
        }));
        body.Children.Add(Item(Icons.X, "Quit", () => (Application.Current?.ApplicationLifetime as Avalonia.Controls.ApplicationLifetimes.IClassicDesktopStyleApplicationLifetime)?.Shutdown()));
        flyout.Content = new Border
        {
            Width = 240,
            Margin = new Thickness(10),
            Padding = new Thickness(6),
            CornerRadius = new CornerRadius(10),
            Background = new SolidColorBrush(Color.Parse("#1E1E1E")),
            BoxShadow = BoxShadows.Parse("inset 0 0 0 1 #29C8C8C8, 0 8 40 0 #8C000000"),
            Child = body,
        };
        flyout.ShowAt(anchor);
        _ = Account(session, user);
    }

    static async Task Account(Session session, TextBlock user)
    {
        try
        {
            user.Text = Api.Text((await session.Api.Get("/me/account"))["username"]);
        }
        catch (Exception e) when (Blocks.Expected(e))
        {
            user.Text = "ECHO";
        }
    }

    public static Bitmap Logo() => new(AssetLoader.Open(new Uri("avares://ECHO/Assets/echo.ico")));

    public static Button Item(Icon icon, string name, Action click) =>
        Item(new Glyph(icon, 20), new TextBlock { Text = name, FontSize = 15, VerticalAlignment = VerticalAlignment.Center }, click);

    static Button Item(Control icon, Control label, Action click)
    {
        var b = new Button
        {
            Theme = Kit.Res<ControlTheme>("Plain"),
            Padding = new Thickness(12, 8),
            Margin = new Thickness(0, 2),
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left,
            Content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { icon, label } },
        };
        b.Click += (_, _) => click();
        return b;
    }
}

/// Cider's now-playing menu (the bar's "…" and a right click on the song): Love, Add to Playlist, Go to
/// Artist, Go to Album. (Add to Library, Start Radio and Share are Apple Music's.)
public static class NowPlayingMenu
{
    public static void Show(Control anchor, Session session, Nav nav)
    {
        if (session.Player.Track is not { } t) return;
        MenuItem Item(string header, Action act)
        {
            var m = new MenuItem { Header = header };
            m.Click += (_, _) => act();
            return m;
        }
        var add = new MenuItem { Header = "Add to Playlist" };
        _ = FillPlaylists(add, session, t);
        var items = new List<MenuItem>
        {
            Item("Love", () => _ = Quietly(session.Library.Star(StarKind.Track, t.Id, true))),
            add,
        };
        if (t.Artists.FirstOrDefault()?.Id is { } artist) items.Add(Item("Go to Artist", () => nav.Open(new Route("artist", artist, t.Artist))));
        if (t.Album.Id is { } album) items.Add(Item("Go to Album", () => nav.Open(new Route("album", album, t.Album.Title))));
        new ContextMenu { ItemsSource = items }.Open(anchor);
    }

    static async Task FillPlaylists(MenuItem add, Session session, Track t)
    {
        try
        {
            add.ItemsSource = (await session.Library.Playlists()).Select(p =>
            {
                var m = new MenuItem { Header = p.Name };
                m.Click += (_, _) => _ = Quietly(session.Library.AddToPlaylist(p.Id, [t.Id]));
                return m;
            }).ToList();
        }
        catch (Exception e) when (Blocks.Expected(e)) { }
    }

    static async Task Quietly(Task call)
    {
        try
        {
            await call;
        }
        catch (Exception e) when (Blocks.Expected(e)) { }
    }
}

/// Cider's settings window (views/components/settings-window.ejs; style.less .settings-window,
/// .md-option-*): 90 % of the window, radius 10, Cider's shadow; the tabs down the left; each tab's
/// options under a header (10 px, 500, rgb(255 255 255 / 10%)) as lines 14 px in. Only what applies to
/// ECHO: the window layout, scrobbling, the account, about.
public sealed class SettingsWindow : Border
{
    readonly Session session;
    readonly ContentControl page = new();
    readonly StackPanel tabs = new() { Width = 200, Margin = new Thickness(8, 56, 8, 8) };

    public event Action? Closed;

    public SettingsWindow(Session session, string tab = "General")
    {
        this.session = session;
        Margin = new Thickness(0);
        CornerRadius = new CornerRadius(10);
        Background = new SolidColorBrush(Color.Parse("#232323"));
        BoxShadow = BoxShadows.Parse("inset 0 0 0 1 #29C8C8C8, 0 8 40 0 #8C000000");
        ClipToBounds = true;
        var close = Kit.IconButton(Icons.X, 32, 32, 16, "Close", () => Closed?.Invoke(), 0.8);
        close.HorizontalAlignment = HorizontalAlignment.Right;
        close.VerticalAlignment = VerticalAlignment.Top;
        close.Margin = new Thickness(10);
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*") };
        grid.Children.Add(new Border { Background = new SolidColorBrush(Color.Parse("#0DFFFFFF")), Child = tabs });
        grid.Children.Add(new ScrollViewer { [Grid.ColumnProperty] = 1, Padding = new Thickness(24, 56, 24, 24), Content = page });
        Child = new Panel
        {
            Children =
            {
                grid,
                new TextBlock { Text = "Settings", FontSize = 20, FontWeight = FontWeight.Bold, Margin = new Thickness(18, 14) },
                close,
            },
        };
        foreach (var name in new[] { "General", "Visual", "Account", "About" })
        {
            var b = new Button { Theme = Kit.Res<ControlTheme>("SidebarItem"), Content = new TextBlock { Text = name, FontSize = 14 }, Tag = name };
            b.Click += (_, _) => Open(name);
            tabs.Children.Add(b);
        }
        Open(tab);
    }

    public void Open(string tab)
    {
        foreach (var b in tabs.Children.OfType<Button>()) b.Classes.Set("active", (string?)b.Tag == tab);
        page.Content = tab switch
        {
            "Visual" => Container("Visual", Line("Window Layout", "Mojave: the player at the bottom. Maverick: the player in the top bar.", Layout())),
            "Account" => Account(),
            "About" => About(),
            _ => Container("General", Line("Scrobble", "Send what you play to Navidrome (and on to Last.fm, when Navidrome is set up for it).", Scrobble())),
        };
    }

    Control Layout()
    {
        var box = new ComboBox { Classes = { "md" }, ItemsSource = new[] { "Mojave", "Maverick" }, SelectedIndex = session.Prefs.Layout == "maverick" ? 1 : 0 };
        box.SelectionChanged += (_, _) => session.Set(session.Prefs with { Layout = box.SelectedIndex == 1 ? "maverick" : "mojave" });
        return box;
    }

    Control Scrobble()
    {
        var toggle = new ToggleSwitch { IsChecked = session.Prefs.Scrobble, OnContent = null, OffContent = null };
        toggle.IsCheckedChanged += (_, _) => session.Set(session.Prefs with { Scrobble = toggle.IsChecked == true });
        return toggle;
    }

    Control Account()
    {
        var who = new TextBlock { FontSize = 13.6 };
        _ = Who(who);
        var signOut = Kit.CiderButton("Sign Out", Icons.LogOut, () =>
        {
            Closed?.Invoke();
            _ = session.Player.SignOut();
        });
        return Container("Account", Line("Signed in", null, who), Line("This computer", "Signing out ends this device's session on the server too.", signOut));
    }

    async Task Who(TextBlock who)
    {
        try
        {
            who.Text = $"{Api.Text((await session.Api.Get("/me/account"))["username"])} on {new Uri(session.Api.Base).Host}";
        }
        catch (Exception e) when (Blocks.Expected(e))
        {
            who.Text = new Uri(session.Api.Base).Host;
        }
    }

    static Control About()
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "";
        return Container("About",
            Line("ECHO for Windows", null, new TextBlock { Text = version, FontSize = 13.6, Opacity = 0.7 }),
            Line("Design", "After Cider 1 (github.com/ciderapp/Cider) by the Cider Collective, AGPL-3.0. ECHO is AGPL-3.0 too.", new Control()));
    }

    /// .md-option-container: the header, then the lines with a rgb(0 0 0 / 15%) rule between.
    static Control Container(string header, params Control[] lines)
    {
        var column = new StackPanel();
        column.Children.Add(new Border
        {
            Padding = new Thickness(10),
            Background = new SolidColorBrush(Color.FromArgb(26, 255, 255, 255)),
            BorderBrush = new SolidColorBrush(Color.FromArgb(64, 200, 200, 200)),
            BorderThickness = new Thickness(0, 0, 0, 1),
            Child = new TextBlock { Text = header, FontSize = 14.4, FontWeight = FontWeight.Medium },
        });
        for (var i = 0; i < lines.Length; i++)
        {
            if (i > 0) lines[i] = new Border { BorderBrush = new SolidColorBrush(Color.FromArgb(38, 0, 0, 0)), BorderThickness = new Thickness(0, 1, 0, 0), Child = lines[i] };
            column.Children.Add(lines[i]);
        }
        return new Border
        {
            CornerRadius = new CornerRadius(10),
            ClipToBounds = true,
            Background = new SolidColorBrush(Color.FromArgb(13, 255, 255, 255)),
            Child = column,
            MaxWidth = 900,
            VerticalAlignment = VerticalAlignment.Top,
        };
    }

    /// .md-option-line: the name (and a note under it) on the left, the control on the right, 14 px in.
    static Control Line(string name, string? note, Control control)
    {
        var grid = new Grid { ColumnDefinitions = new ColumnDefinitions("*,Auto"), Margin = new Thickness(14) };
        var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Children = { new TextBlock { Text = name, FontSize = 13.6 } } };
        if (note is not null) text.Children.Add(new TextBlock { Text = note, FontSize = 12, Opacity = 0.6, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 16, 0) });
        grid.Children.Add(text);
        control.VerticalAlignment = VerticalAlignment.Center;
        grid.Children.Add(new Border { [Grid.ColumnProperty] = 1, Child = control });
        return grid;
    }
}
