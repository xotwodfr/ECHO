using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Threading;

namespace Echo.Ui;

/// ECHO's one window: sign-in, or the shell for a session. `--smoke` shows the fixtures maximised, opens
/// the Listen room after 8 s and exits 0 after 16 s (the Windows CI screenshots both; a self-extracting
/// exe on a fresh runner takes a few seconds to show its window).
public partial class MainWindow : Window
{
    public MainWindow() : this(App.Smoke ? Session.ForFixtures() : null) { }

    public MainWindow(Session? session)
    {
        InitializeComponent();
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
            TokenStore.Forget();
            session.Api.Token = null;
            ShowSignIn(session.Api);
        });
        Content = new Shell(session);
    }

    void Smoke(Session session)
    {
        WindowState = WindowState.Maximized;
        DispatcherTimer.RunOnce(() => session.Nav.Go(new ListenPage()), TimeSpan.FromSeconds(8));
        DispatcherTimer.RunOnce(() => (Application.Current?.ApplicationLifetime as IClassicDesktopStyleApplicationLifetime)?.Shutdown(0),
            TimeSpan.FromSeconds(16));
    }
}
