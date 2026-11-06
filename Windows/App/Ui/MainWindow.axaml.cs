using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Threading;

namespace Echo.Ui;

/// ECHO's one window: sign-in, or the library once signed in. `--smoke` shows the sign-in and exits 0
/// after 8 s (the Windows CI screenshots it in between).
public partial class MainWindow : Window
{
    Session? session;

    public MainWindow()
    {
        InitializeComponent();
        var api = new Api(Environment.GetEnvironmentVariable("ECHO_URL") is { Length: > 0 } url ? url : "https://echo.folk3s.com");
        if (App.Smoke)
        {
            ShowSignIn(api);
            DispatcherTimer.RunOnce(() => (Application.Current?.ApplicationLifetime as IClassicDesktopStyleApplicationLifetime)?.Shutdown(0),
                TimeSpan.FromSeconds(8));
            return;
        }
        api.Token = TokenStore.Load();
        if (api.Token is null) ShowSignIn(api);
        else ShowLibrary(api);
    }

    void ShowSignIn(Api api)
    {
        session?.Player.Dispose();
        session = Session.Current = null;
        api.Token = null;
        Content = new SignInView(api, token =>
        {
            TokenStore.Save(token);
            api.Token = token;
            ShowLibrary(api);
        });
    }

    void ShowLibrary(Api api)
    {
        session = Session.Current = new Session(api);
        session.SignedOut += () => Dispatcher.UIThread.Post(() =>
        {
            TokenStore.Forget();
            ShowSignIn(api);
        });
        Content = new LibraryView(session);
        _ = session.Player.Restore();
    }

    protected override void OnClosed(EventArgs e)
    {
        session?.Player.Dispose();
        base.OnClosed(e);
    }
}
