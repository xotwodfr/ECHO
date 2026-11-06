using System.Net;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Echo.Glass;
using Echo.Ui;

namespace Echo.Tests;

public class ShellTests
{
    [AvaloniaFact]
    public void SmokeShellShowsGlassOverCovers()
    {
        var window = new MainWindow(Session.ForFixtures()) { Width = 1280, Height = 800 };
        window.Show();
        Dispatcher.UIThread.RunJobs();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick();

        var glass = window.GetVisualDescendants().OfType<GlassPanel>().ToList();
        Assert.Contains(glass, g => g.Name == "Sidebar");
        Assert.Contains(glass, g => g.Name == "Pill");
        Assert.True(window.GetVisualDescendants().OfType<CoverImage>().Count(c => c.Bitmap is not null) >= 10);
        Shots.Save(window, "shell");
    }

    [AvaloniaFact]
    public async Task SignInShowsTheCodeFieldOnlyAfterTheServerAsks()
    {
        var api = new Api("https://echo.test", new Answer(HttpStatusCode.Unauthorized, """{"error":"totp_required"}"""));
        var view = new SignInView(api, _ => { });
        var window = new Window { Content = view };
        window.Show();
        Assert.False(view.CodeVisible);

        view.Username = "ada";
        view.Password = "secret";
        await view.Submit();

        Assert.True(view.CodeVisible);
    }
}

/// An HTTP answer for every request.
sealed class Answer(HttpStatusCode status, string json) : HttpMessageHandler
{
    public List<HttpRequestMessage> Requests { get; } = [];

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
    {
        Requests.Add(request);
        return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(json) });
    }
}

/// Captures for a person to look at: written only when ECHO_TEST_SHOTS names a folder.
static class Shots
{
    public static void Save(TopLevel top, string name)
    {
        if (Environment.GetEnvironmentVariable("ECHO_TEST_SHOTS") is not { Length: > 0 } dir) return;
        Directory.CreateDirectory(dir);
        using var frame = top.CaptureRenderedFrame();
        frame?.Save(Path.Combine(dir, $"{name}.png"), new Avalonia.Media.Imaging.PngBitmapEncoderOptions());
    }
}
