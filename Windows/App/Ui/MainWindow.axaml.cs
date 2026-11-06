using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Threading;

namespace Echo.Ui;

/// ECHO's one window: sign-in, or the shell for a session. `--smoke` shows the fixtures, opens the
/// Listen room after 3 s and exits 0 after 10 s (the Windows CI screenshots it in between).
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

    static void Smoke(Session session)
    {
        DispatcherTimer.RunOnce(() => session.Nav.Go(new ListenPage()), TimeSpan.FromSeconds(3));
        DispatcherTimer.RunOnce(() => (Application.Current?.ApplicationLifetime as IClassicDesktopStyleApplicationLifetime)?.Shutdown(0),
            TimeSpan.FromSeconds(10));
    }
}
