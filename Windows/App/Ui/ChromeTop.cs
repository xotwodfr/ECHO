using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Shapes;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Styling;
using Path = Avalonia.Controls.Shapes.Path;

namespace Echo.Ui;

/// Cider's top chrome (views/app/chrome-top.ejs; style.less .app-chrome; less/directives.less). In the
/// default layout, Mojave: 46 px on the window's ground; on the left the main menu, Back, Forward and the
/// library toggle; in the middle a round Home (Cider's tab group; Listen Now, Browse and Radio are Apple
/// Music's) beside a wide search pill; on the right the window's own controls. In Maverick (the player up here, given a session): 55 px;
/// the Transport after Back and Forward, the Lcd in the middle, the BarTools on the right. The empty
/// parts move the window.
public sealed class ChromeTop : Grid
{
    public const double Height1 = 46, HeightMaverick = 55;

    readonly Nav nav;
    readonly Button back, forward, toggle;
    readonly Button? home;
    readonly TextBox search = new() { Width = 180, PlaceholderText = "Search...", Classes = { "search" } };
    bool sidebarShown = true;

    public event Action<Control>? MenuRequested;
    public event Action? SidebarToggled;
    /// Enter in the search field.
    public event Action<string>? Searched;

    public ChromeTop(Nav nav, Session? maverick = null)
    {
        this.nav = nav;
        Height = maverick is null ? Height1 : HeightMaverick;
        Background = Brushes.Transparent; // on the ground, and still a drag handle
        // Cider's 30 % | flex | 30 %, which frees the middle under 1100 px: here the sides share what the
        // middle leaves (Mojave's tabs stay centred), so the window's controls always fit.
        ColumnDefinitions = new ColumnDefinitions(maverick is null ? "*,Auto,*" : "Auto,*,Auto");

        // .app-mainmenu: 30 px, 16 px either side; Cider's logo there, ECHO's here.
        var menu = new Button
        {
            Theme = Kit.Res<ControlTheme>("Plain"),
            Width = 30, Height = 30, Margin = new Thickness(16, 1.5, 16, 0), CornerRadius = new CornerRadius(15),
            Content = new Image { Source = new Bitmap(AssetLoader.Open(new Uri("avares://ECHO/Assets/echo.ico"))), Width = 30, Height = 30 },
        };
        ToolTip.SetTip(menu, "Menu");
        menu.Click += (_, _) => MenuRequested?.Invoke(menu);
        back = Kit.IconButton(Icons.ChevronLeft, 40, 36, 14, "Back", nav.Back);
        forward = Kit.IconButton(Icons.ChevronRight, 40, 36, 14, "Forward", nav.Forward);
        toggle = Kit.IconButton(Icons.SidebarShown, 40, 36, 16, "Hide Library", () =>
        {
            sidebarShown = !sidebarShown;
            ((Glyph)toggle!.Content!).Icon = sidebarShown ? Icons.SidebarShown : Icons.SidebarHidden;
            ToolTip.SetTip(toggle, sidebarShown ? "Hide Library" : "Show Library");
            SidebarToggled?.Invoke();
        });
        var vdiv = new Rectangle { Width = 1, Height = Height / 2, Fill = Brushes.White, Opacity = 0.25, Margin = new Thickness(6) };
        var left = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        Children.Add(left);
        if (maverick is not null)
        {
            Tools = new BarTools(maverick);
            left.Children.AddRange([menu, back, forward, vdiv, new Transport(maverick.Player)]);
            Lcd = new Lcd(maverick, nav) { [Grid.ColumnProperty] = 1 };
            Children.Add(Lcd);
            Children.Add(new StackPanel
            {
                [Grid.ColumnProperty] = 2,
                Orientation = Orientation.Horizontal,
                HorizontalAlignment = HorizontalAlignment.Right,
                Children = { Tools, WindowControls(this, Height) },
            });
            nav.Changed += Show;
            Show();
            return;
        }
        left.Children.AddRange([menu, vdiv, back, forward, toggle]);

        // Cider's tab group held only Home here; today's bar puts a round Home and a wide search pill together
        // in the middle, as Spotify's does, and leaves the right to the window's controls.
        home = TabItem(Icons.Home, "Home", () => nav.Open(new Route("home")));
        search.Width = 360;
        search.Height = 36;
        search.CornerRadius = new CornerRadius(18);
        search.Padding = new Thickness(38, 0, 14, 0);
        search.PlaceholderText = "Search your library";
        search.Classes.Add("pill");
        search.KeyDown += (_, e) =>
        {
            if (e.Key == Key.Enter && !string.IsNullOrWhiteSpace(search.Text)) Searched?.Invoke(search.Text.Trim());
        };
        var field = new Panel
        {
            VerticalAlignment = VerticalAlignment.Center,
            Children =
            {
                search,
                new Glyph(Icons.Search, 14) { Margin = new Thickness(15, 0, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, Opacity = 0.6, IsHitTestVisible = false },
            },
        };
        Children.Add(new StackPanel
        {
            [Grid.ColumnProperty] = 1,
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
            Spacing = 8,
            Children = { home, field },
        });
        Children.Add(new Border { [Grid.ColumnProperty] = 2, HorizontalAlignment = HorizontalAlignment.Right, Child = WindowControls(this, Height) });

        nav.Changed += Show;
        Show();
    }

    /// Maverick's volume, queue and lyrics, and its player display; null in Mojave (the bottom chrome
    /// has them).
    public BarTools? Tools { get; }
    public Lcd? Lcd { get; }

    /// Clears the field (a new search starts empty).
    public string SearchText
    {
        get => search.Text ?? "";
        set => search.Text = value;
    }

    void Show()
    {
        back.IsEnabled = nav.CanBack;
        forward.IsEnabled = nav.CanForward;
        home?.Classes.Set("active", nav.Current.Page == "home");
    }

    /// A round 36 px button with the icon alone (the name as its tip), lit while its page shows.
    static Button TabItem(Icon icon, string name, Action click)
    {
        var b = new Button
        {
            Theme = Kit.Res<ControlTheme>("TopNavItem"),
            Width = 36,
            Height = 36,
            Padding = new Thickness(0),
            Content = new Glyph(icon, 18),
        };
        ToolTip.SetTip(b, name);
        b.Click += (_, _) => click();
        return b;
    }

    // ---- the window's own controls: 138 px, three of 46, Windows' 10 px glyphs (the sign-in screen has them too) ----

    public static Control WindowControls(Control host, double height)
    {
        var max = Caption(host, height, "M0.5,0.5 H9.5 V9.5 H0.5 Z", "Maximize", w => w.WindowState = w.WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized);
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Height = height,
            HorizontalAlignment = HorizontalAlignment.Right,
            Children =
            {
                Caption(host, height, "M0,5.5 H10", "Minimize", w => w.WindowState = WindowState.Minimized),
                max,
                Caption(host, height, "M0,0 L10,10 M10,0 L0,10", "Close", w => w.Close(), close: true),
            },
        };
        host.AttachedToVisualTree += (_, _) =>
        {
            if (TopLevel.GetTopLevel(host) is not Window w) return;
            w.PropertyChanged += (_, e) =>
            {
                if (e.Property != Window.WindowStateProperty) return;
                ((Path)max.Content!).Data = Geometry.Parse(w.WindowState == WindowState.Maximized
                    ? "M2.5,2.5 V0.5 H9.5 V7.5 H7.5 M0.5,2.5 H7.5 V9.5 H0.5 Z"
                    : "M0.5,0.5 H9.5 V9.5 H0.5 Z");
            };
        };
        return row;
    }

    static Button Caption(Control host, double height, string glyph, string tip, Action<Window> act, bool close = false)
    {
        var b = new Button
        {
            Theme = Kit.Res<ControlTheme>(close ? "CaptionClose" : "Caption"),
            Classes = { "nopress" },
            Width = 46,
            Height = height,
            Content = new Path { Data = Geometry.Parse(glyph), Stroke = Brushes.White, StrokeThickness = 1, Width = 10, Height = 10 },
        };
        ToolTip.SetTip(b, tip);
        b.Click += (_, _) =>
        {
            if (TopLevel.GetTopLevel(host) is Window w) act(w);
        };
        return b;
    }

    /// Electron's drag region: a press moves the window, a double click maximizes it.
    public static void DragWindow(Control from, PointerPressedEventArgs e)
    {
        if (e.Handled || TopLevel.GetTopLevel(from) is not Window w || !e.GetCurrentPoint(from).Properties.IsLeftButtonPressed) return;
        if (e.ClickCount == 2) w.WindowState = w.WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
        else w.BeginMoveDrag(e);
    }

    // The bar itself moves the window.
    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        DragWindow(this, e);
    }
}
