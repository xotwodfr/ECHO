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
/// default layout, Mojave: 46 px, Base; on the left the main menu, Back, Forward and the library toggle;
/// in the middle the tab group (Home: Listen Now, Browse and Radio are Apple Music's); on the right the
/// search field and the window's own controls. In Maverick (the player up here, given a session): 55 px;
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
        Background = Kit.Brush("Base");
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
                Children = { Tools, WindowControls() },
            });
            nav.Changed += Show;
            Show();
            return;
        }
        left.Children.AddRange([menu, vdiv, back, forward, toggle]);

        // .top-nav-group: #1e1e1e99, 1 px lighten(#1e1e1e, 8 %), radius 12, 32 px; items min 120 px.
        home = TabItem(Icons.Home, "Home", () => nav.Open(new Route("home")));
        Children.Add(new Border
        {
            [Grid.ColumnProperty] = 1,
            Background = new SolidColorBrush(Color.Parse("#991E1E1E")),
            BorderBrush = new SolidColorBrush(Color.Parse("#313131")),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(12),
            Height = 32,
            HorizontalAlignment = HorizontalAlignment.Center,
            Child = home,
        });

        search.KeyDown += (_, e) =>
        {
            if (e.Key == Key.Enter && !string.IsNullOrWhiteSpace(search.Text)) Searched?.Invoke(search.Text.Trim());
        };
        var field = new Panel
        {
            Margin = new Thickness(0, 0, 6, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Children =
            {
                search,
                new Glyph(Icons.Search, 12) { Margin = new Thickness(10, 0, 0, 0), HorizontalAlignment = HorizontalAlignment.Left, Opacity = 0.55, IsHitTestVisible = false },
            },
        };
        Children.Add(new StackPanel
        {
            [Grid.ColumnProperty] = 2,
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Children = { field, WindowControls() },
        });

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

    static Button TabItem(Icon icon, string name, Action click)
    {
        var b = new Button
        {
            Theme = Kit.Res<ControlTheme>("TopNavItem"),
            MinWidth = 120,
            Content = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 8,
                Children = { new Glyph(icon, 16), new TextBlock { Text = name, FontSize = 14, VerticalAlignment = VerticalAlignment.Center } },
            },
        };
        b.Click += (_, _) => click();
        return b;
    }

    // ---- the window's own controls: 138 px, three of 46, Windows' 10 px glyphs ----

    Control WindowControls()
    {
        var max = Caption("M0.5,0.5 H9.5 V9.5 H0.5 Z", "Maximize", w => w.WindowState = w.WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized);
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Height = Height,
            Children =
            {
                Caption("M0,5.5 H10", "Minimize", w => w.WindowState = WindowState.Minimized),
                max,
                Caption("M0,0 L10,10 M10,0 L0,10", "Close", w => w.Close(), close: true),
            },
        };
        AttachedToVisualTree += (_, _) =>
        {
            if (TopLevel.GetTopLevel(this) is not Window w) return;
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

    Button Caption(string glyph, string tip, Action<Window> act, bool close = false)
    {
        var b = new Button
        {
            Theme = Kit.Res<ControlTheme>(close ? "CaptionClose" : "Caption"),
            Classes = { "nopress" },
            Width = 46,
            Height = Height,
            Content = new Path { Data = Geometry.Parse(glyph), Stroke = Brushes.White, StrokeThickness = 1, Width = 10, Height = 10 },
        };
        ToolTip.SetTip(b, tip);
        b.Click += (_, _) =>
        {
            if (TopLevel.GetTopLevel(this) is Window w) act(w);
        };
        return b;
    }

    // The bar itself moves the window, and a double click maximizes it (Electron's drag region).
    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        if (e.Handled || TopLevel.GetTopLevel(this) is not Window w || !e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;
        if (e.ClickCount == 2) w.WindowState = w.WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
        else w.BeginMoveDrag(e);
    }
}
