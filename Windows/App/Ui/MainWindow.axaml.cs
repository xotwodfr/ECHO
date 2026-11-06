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
        Content = new Shell(s);
        if (!s.IsFixtures) _ = s.Player.Restore();
    }

    protected override void OnClosed(EventArgs e)
    {
        session?.Player.Dispose();
        base.OnClosed(e);
    }
}
