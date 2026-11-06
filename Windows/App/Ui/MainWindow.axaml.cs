using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Threading;
using Echo.Playback;

namespace Echo.Ui;

/// ECHO's one window: sign-in, or the library once signed in. `--smoke` shows the sign-in and exits 0
/// after 8 s (the Windows CI screenshots it in between).
public partial class MainWindow : Window
{
    Player? player;

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
        player?.Dispose();
        player = null;
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
        player = new Player(api, () => new AudioOut());
        player.SignedOut += () => Dispatcher.UIThread.Post(() =>
        {
            TokenStore.Forget();
            ShowSignIn(api);
        });
        Content = new LibraryView(api, player);
    }

    protected override void OnClosed(EventArgs e)
    {
        player?.Dispose();
        base.OnClosed(e);
    }
}
