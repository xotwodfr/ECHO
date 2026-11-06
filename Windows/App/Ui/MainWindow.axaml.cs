using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;

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
    Session? current;

    public MainWindow(Session? session)
    {
        InitializeComponent();
        seen.Tick += (_, _) =>
        {
            Seen.Update(this);
            // Windows' Transparency effects, switched in Settings: every glass surface follows.
            if (Transparency.Sync())
                foreach (var g in this.GetVisualDescendants().OfType<Glass.GlassPanel>()) g.InvalidateVisual();
        };
        Transparency.Sync();
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
            Keep(fullScreen: false);
            return;
        }
        Remembered = Centre;
        WindowState = WindowState.FullScreen;
        Keep(fullScreen: true);
    }

    PixelPoint Centre => Position + new PixelPoint((int)(Bounds.Width * RenderScaling / 2), (int)(Bounds.Height * RenderScaling / 2));

    /// Where the window is and whether it is full screen, for the next start (Settings are per computer).
    void Keep(bool fullScreen)
    {
        if (current is not { Fixtures: false } s) return;
        var at = fullScreen ? Remembered ?? Centre : Centre;
        s.Prefs.Update(p => p with { WindowX = at.X, WindowY = at.Y, FullScreen = fullScreen });
    }

    protected override void OnOpened(EventArgs e)
    {
        base.OnOpened(e);
        if (current is { Fixtures: false } s && s.Prefs.State is { WindowX: { } x, WindowY: { } y } p)
        {
            Remembered = new PixelPoint(x, y);
            PlaceOn(Remembered, p.FullScreen);
        }
    }

    protected override void OnClosing(WindowClosingEventArgs e)
    {
        Keep(WindowState == WindowState.FullScreen);
        base.OnClosing(e);
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
        current = session;
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
