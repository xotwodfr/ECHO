using Avalonia;

namespace Echo;

static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        App.Smoke = args.Contains("--smoke");
        return BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>().UsePlatformDetect().WithInterFont().LogToTrace();
}
