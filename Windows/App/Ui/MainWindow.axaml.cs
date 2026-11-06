using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Input;
using Avalonia.Threading;

namespace Echo.Ui;

/// ECHO's one window: sign-in, or the shell for a session. `--smoke` shows the fixtures maximised, opens
/// the Listen room after 8 s and exits 0 after 16 s (the Windows CI screenshots both; a self-extracting
/// exe on a fresh runner takes a few seconds to show its window).
public partial class MainWindow : Window
{
    public MainWindow() : this(App.Smoke ? Session.ForFixtures() : null) { }

    /// The centre of the window when it last went full screen: the monitor it goes back to.
    public static PixelPoint? Remembered { get; set; }

    readonly DispatcherTimer seen = new() { Interval = TimeSpan.FromSeconds(1) };

    public MainWindow(Session? session)
    {
        InitializeComponent();
        seen.Tick += (_, _) => Seen.Update(this);
        seen.Start();
        PropertyChanged += (_, e) =>
        {
            if (e.Property == WindowStateProperty) Seen.Update(this);
        };
        if (session is not null) ShowShell(session);
        else
        {
            var api = new Api(Environment.GetEnvironmentVariable("ECHO_URL") is { Length: > 0 } url ? url : "https://echo.folk3s.com")
            {
                Token = TokenStore.Load(),
            };
            if (api.Token is null) ShowSignIn(api);
            else ShowShell(Session.ForServer(api));
        }
        if (App.Smoke && session?.Fixtures == true) Smoke(session);
    }

    /// Full screen on the monitor the window is on (F11, double-click the room, the room's button); again
    /// or Esc leaves it.
    public void ToggleFullScreen()
    {
        if (WindowState == WindowState.FullScreen)
        {
            WindowState = WindowState.Normal;
            return;
        }
        Remembered = Position + new PixelPoint((int)(Bounds.Width * RenderScaling / 2), (int)(Bounds.Height * RenderScaling / 2));
        WindowState = WindowState.FullScreen;
    }

    /// Opens on the remembered monitor (or the primary when it is gone), full screen when it was.
    public void PlaceOn(PixelPoint? remembered, bool fullScreen)
    {
        var all = Screens.All;
        if (all.Count == 0) return;
        var screen = all[Monitors.Pick(all.Select(s => (s.Bounds, s.IsPrimary)).ToList(), remembered)];
        Position = screen.WorkingArea.Position + new PixelPoint(40, 40);
        if (fullScreen) WindowState = WindowState.FullScreen;
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.Key == Key.F11 || (e.Key == Key.Escape && WindowState == WindowState.FullScreen))
        {
            ToggleFullScreen();
            e.Handled = true;
        }
    }

    void ShowSignIn(Api api)
    {
        Session.Current = null;
        Content = new SignInView(api, token =>
        {
            TokenStore.Save(token);
            api.Token = token;
            ShowShell(Session.ForServer(api));
        });
    }

    void ShowShell(Session session)
    {
        Session.Current = session;
        session.SignedOut += () => Dispatcher.UIThread.Post(() =>
        {
            session.Player.Dispose();
            TokenStore.Forget();
            session.Api.Token = null;
            ShowSignIn(session.Api);
        });
        Content = new Shell(session);
#if WINDOWS
        Playback.Smtc.Attach(session.Player, session.Covers); // the smoke run too: CI sees it start
#endif
    }

    void Smoke(Session session)
    {
        WindowState = WindowState.Maximized;
        DispatcherTimer.RunOnce(() => session.Nav.Go(new ListenPage()), TimeSpan.FromSeconds(8));
        DispatcherTimer.RunOnce(() => (Application.Current?.ApplicationLifetime as IClassicDesktopStyleApplicationLifetime)?.Shutdown(0),
            TimeSpan.FromSeconds(16));
    }
}
