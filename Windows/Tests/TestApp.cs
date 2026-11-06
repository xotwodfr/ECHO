using Avalonia;
using Avalonia.Headless;

[assembly: AvaloniaTestApplication(typeof(Echo.Tests.TestAppBuilder))]

namespace Echo.Tests;

/// The app headless, drawn by Skia for real (not the headless null drawing), so a test can read pixels.
public static class TestAppBuilder
{
    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UseSkia()
            .WithInterFont()
            .UseHeadless(new AvaloniaHeadlessPlatformOptions { UseHeadlessDrawing = false });
}
