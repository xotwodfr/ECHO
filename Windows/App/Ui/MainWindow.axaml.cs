using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Media;
using Avalonia.Threading;

namespace Echo.Ui;

/// ECHO's one window, frameless as Cider's (its top chrome carries the window's controls), over Windows
/// 11's Mica where there is one: sign-in, or Cider's shell once signed in. `--smoke` opens the shell on
/// the built-in library and exits 0 after 8 s (the Windows CI screenshots it in between).
public partial class MainWindow : Window
{
    Session? session;

    public MainWindow()
    {
        InitializeComponent();
        PropertyChanged += (_, e) =>
        {
            // Cider's layers are translucent: over Mica they take the wallpaper's tint, else Mica's grey.
            if (e.Property == ActualTransparencyLevelProperty)
                Background = ActualTransparencyLevel == WindowTransparencyLevel.Mica ? Brushes.Transparent : Kit.Brush("WindowFallback");
        };
        var api = new Api(Environment.GetEnvironmentVariable("ECHO_URL") is { Length: > 0 } url ? url : "https://echo.folk3s.com");
        if (App.Smoke)
        {
            Open(Session.ForFixtures());
            DispatcherTimer.RunOnce(() => (Application.Current?.ApplicationLifetime as IClassicDesktopStyleApplicationLifetime)?.Shutdown(0),
                TimeSpan.FromSeconds(8));
            return;
        }
        api.Token = TokenStore.Load();
        if (api.Token is null) ShowSignIn(api);
        else Open(new Session(api));
    }

    /// The shell on show, once signed in.
    public Shell? Shell => Content as Shell;

    void ShowSignIn(Api api)
    {
        session?.Player.Dispose();
        session = Session.Current = null;
        api.Token = null;
        Content = new SignInView(api, token =>
        {
            TokenStore.Save(token);
            api.Token = token;
            Open(new Session(api));
        });
    }

    public void Open(Session s)
    {
        session = Session.Current = s;
        s.SignedOut += () => Dispatcher.UIThread.Post(() =>
        {
            TokenStore.Forget();
            ShowSignIn(s.Api);
        });
        Show(s);
        // Settings → Visual → Window Layout: the shell is built again in the other layout.
        s.PrefsChanged += () =>
        {
            if (Content is Shell old && old.Maverick != (s.Prefs.Layout == "maverick"))
            {
                var tab = old.Settings is not null;
                Show(s);
                if (tab) Dispatcher.UIThread.Post(() => Shell?.ShowSettings("Visual"));
            }
        };
        if (!s.IsFixtures) _ = s.Player.Restore();
    }

    void Show(Session s)
    {
        var shell = new Shell(s);
        shell.FullscreenRequested += () => Fullscreen(shell);
        shell.MiniRequested += () => Mini(shell);
        Content = shell;
    }

    // ---- Cider's other app modes: the fullscreen view and the mini player ----

    WindowState before;
    Size beforeSize;
    PixelPoint beforeAt;

    /// Cider 4's immersive view, the window full screen; back on Escape or the bar's exit button.
    public void Fullscreen(Shell shell)
    {
        before = WindowState;
        var view = new ImmersiveView(session!, shell.Nav);
        view.Closed += () => Back(shell);
        Content = view;
        WindowState = WindowState.FullScreen;
        view.Focus();
    }

    /// Cider's mini player: the window 300 px square (250 at least), where it was last time.
    public void Mini(Shell shell)
    {
        (before, beforeSize, beforeAt) = (WindowState, new Size(Width, Height), Position);
        WindowState = WindowState.Normal;
        MinWidth = MinHeight = 250;
        Width = Height = 300;
        var view = new MiniPlayer(session!);
        view.Closed += () => Back(shell);
        Content = view;
    }

    void Back(Shell shell)
    {
        var wasMini = Content is MiniPlayer;
        Topmost = false;
        Content = shell;
        (MinWidth, MinHeight) = (1024, 640);
        if (wasMini)
        {
            (Width, Height) = (beforeSize.Width, beforeSize.Height);
            Position = beforeAt;
        }
        WindowState = before;
    }

    protected override void OnKeyDown(Avalonia.Input.KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (!e.Handled && Content is Shell shell) shell.Keys(e);
    }

    bool saved;

    /// Where the song is, saved before the window goes (it is saved 15 s apart while playing): the window
    /// hides at once and closes when the server has it, 2 s at most.
    protected override async void OnClosing(WindowClosingEventArgs e)
    {
        base.OnClosing(e);
        if (e.Cancel || saved || session is null || e.CloseReason == WindowCloseReason.ApplicationShutdown) return;
        e.Cancel = true;
        saved = true;
        Hide();
        await Task.WhenAny(session.Player.SaveNow(), Task.Delay(2000));
        Close();
    }

    protected override void OnClosed(EventArgs e)
    {
        session?.Player.Dispose();
        base.OnClosed(e);
    }
}
