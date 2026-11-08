using System.Net;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Echo.Playback;
using Echo.Ui;

namespace Echo.Tests;

public class BaselineTests
{
    [AvaloniaFact]
    public void TheWindowOpens()
    {
        var window = new MainWindow();
        window.Show();
        Assert.Equal("ECHO", window.Title);
        Assert.Equal(1024, window.MinWidth);
    }

    [AvaloniaFact]
    public async Task SignInShowsTheCodeFieldOnlyAfterTheServerAsks()
    {
        var api = new Api("https://echo.test", new Answer(HttpStatusCode.Unauthorized, """{"error":"totp_required"}"""));
        var view = new SignInView(api, _ => { });
        new Window { Content = view }.Show();
        Assert.False(view.CodeVisible);
        view.Username = "ada";
        view.Password = "secret";
        await view.Submit();
        Assert.True(view.CodeVisible);
    }

    [Theory]
    [InlineData("flac", true)]
    [InlineData("audio/mpeg", true)]
    [InlineData("audio/x-wav", true)]
    [InlineData("audio/mp4", false)]
    [InlineData("opus", false)]
    [InlineData(null, false)]
    public void OnlyFlacMp3AndWavStreamRaw(string? type, bool raw) => Assert.Equal(raw, StreamFormat.PlaysRaw(type));
}

/// An HTTP answer for every request, and the requests it got.
public class CrashLogTests
{
    [Fact]
    public void AnErrorNothingCaughtIsWrittenDownWithTheVersion()
    {
        var file = Path.Combine(Path.GetTempPath(), $"echo-crash-{Guid.NewGuid():N}", "crash.log");
        try
        {
            CrashLog.Write(new InvalidOperationException("first"), file);
            CrashLog.Write(new InvalidOperationException("second"), file);
            var log = File.ReadAllText(file);
            Assert.Contains("first", log);
            Assert.Contains("second", log); // added to, not replaced
            Assert.Contains($"ECHO {typeof(CrashLog).Assembly.GetName().Version}", log);
        }
        finally
        {
            Directory.Delete(Path.GetDirectoryName(file)!, recursive: true);
        }
    }
}

sealed class Answer(HttpStatusCode status, string json) : HttpMessageHandler
{
    public List<HttpRequestMessage> Requests { get; } = [];

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
    {
        Requests.Add(request);
        return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(json) });
    }
}
