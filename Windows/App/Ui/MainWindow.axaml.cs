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
        media?.Dispose();
        media = null;
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

    /// Windows' media controls for the session (MediaControls): media keys, the volume flyout, the lock screen.
    IDisposable? media;

    void AttachMediaControls()
    {
        media?.Dispose();
        media = session is null ? null : MediaControls.For(this, session);
    }

    protected override void OnOpened(EventArgs e)
    {
        base.OnOpened(e);
        if (media is null) AttachMediaControls(); // in case the window had no handle before it opened
    }

    public void Open(Session s)
    {
        session = Session.Current = s;
        AttachMediaControls();
        s.SignedOut += () => Dispatcher.UIThread.Post(() =>
        {
            TokenStore.Forget();
            ShowSignIn(s.Api);
        });
        Show(s);
        PutBack(s);
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

    /// Puts back what closing kept (Keep): the volume, and the window's place if that is on a screen still.
    void PutBack(Session s)
    {
        s.Player.Volume = s.Prefs.Volume;
        if (s.Prefs.Window is not { } at) return;
        (Width, Height) = (Math.Max(at.Width, MinWidth), Math.Max(at.Height, MinHeight));
        var corner = new PixelPoint(at.X, at.Y);
        if (Screens.ScreenCount == 0 || Screens.ScreenFromPoint(corner) is not null) Position = corner;
        if (at.Maximized) WindowState = WindowState.Maximized;
    }

    /// The volume and the window's place, for next time. The place only from the shell: the mini player and
    /// full screen are not the window's own size. Maximized, the size kept is the one from before.
    // ponytail: the size before maximizing is the last one kept; track it live if that ever surprises.
    void Keep()
    {
        if (session is not { } s) return;
        var place = Shell is null ? s.Prefs.Window
            : WindowState == WindowState.Maximized ? (s.Prefs.Window ?? new WindowPlace(Position.X, Position.Y, 1336, 768, false)) with { Maximized = true }
            : new WindowPlace(Position.X, Position.Y, ClientSize.Width, ClientSize.Height, false);
        s.Set(s.Prefs with { Volume = s.Player.Volume, Window = place });
    }

    bool saved;

    /// Where the song is, saved before the window goes (it is saved 15 s apart while playing): the window
    /// hides at once and closes when the server has it, 2 s at most.
    protected override async void OnClosing(WindowClosingEventArgs e)
    {
        base.OnClosing(e);
        if (!e.Cancel && !saved) Keep();
        if (e.Cancel || saved || session is null || e.CloseReason == WindowCloseReason.ApplicationShutdown) return;
        e.Cancel = true;
        saved = true;
        Hide();
        await Task.WhenAny(session.Player.SaveNow(), Task.Delay(2000));
        Close();
    }

    protected override void OnClosed(EventArgs e)
    {
        media?.Dispose();
        session?.Player.Dispose();
        base.OnClosed(e);
    }
}
