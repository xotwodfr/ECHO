using Avalonia;

namespace Echo;

static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        App.Smoke = args.Contains("--smoke");
        // The window's errors come out of the dispatcher's loop to here too.
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            if (e.ExceptionObject is Exception x) CrashLog.Write(x, CrashLog.File);
        };
        return BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>().UsePlatformDetect().WithInterFont().LogToTrace();
}
