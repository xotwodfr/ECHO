using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

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
        Children.Add(navigation);
        Children.Add(new Border { [Grid.RowProperty] = 1, Child = Bottom });

        Top.SidebarToggled += () => sidebar.IsVisible = !sidebar.IsVisible;
        Top.Searched += term => Nav.Open(new Route("search", term, term));
        Nav.Changed += Show;
        Show();
    }

    public Nav Nav { get; }
    public ChromeTop Top { get; }
    public ChromeBottom Bottom { get; }

    /// The page on show (tests read it).
    public Control? Page => page.Content as Control;

    void Show() => page.Content = Pages.Create(session, Nav, Nav.Current);
}
