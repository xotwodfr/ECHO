using System.Net;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.LogicalTree;
using Avalonia.Media.Imaging;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Echo.Stage;
using Echo.Stage.Lyrics;

namespace Echo.Tests;

public class LyricsFieldTests
{
    static LyricsDoc Synced() => new("navidrome:t", "word", "fixture", new Attribution("x"),
    [
        Line("First light on the water", 10_000),
        Line("Every echo finds its way home", 14_000),
        Line("And the night lets go", 18_000),
    ]);

    static LyricLine Line(string text, long start)
    {
        var words = text.Split(' ');
        var step = 3000 / words.Length;
        return new LyricLine(text, start, start + 3000, Words: words.Select((w, i) => new LyricWord(w, start + i * step, start + (i + 1) * step)).ToList());
    }

    [AvaloniaFact]
    public void AFieldDrawsTheActiveLineLit()
    {
        var field = new LyricsField(Synced(), () => 15_500, () => true, () => Features.Silent, Fixtures.Palette);
        var window = new Window { Width = 1200, Height = 700, Background = Avalonia.Media.Brushes.Black, Content = field };
        window.Show();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick();
        using var frame = window.CaptureRenderedFrame()!;
        Shots.Save(window, "lyrics");

        var brightest = Enumerable.Range(0, 700).MaxBy(y => RowLight(frame, y));
        Assert.InRange(brightest, 700 * (L.AnchorY - 0.05), 700 * (L.AnchorY + 0.05));
    }

    [AvaloniaFact]
    public async Task NoLyricsMeansMissingNotBlank()
    {
        var api = new Api("https://echo.test", new Answer(HttpStatusCode.NotFound, """{"error":"not_found"}"""));
        var lyrics = new Lyrics(api, wait: (_, _) => Task.CompletedTask);
        await lyrics.Load(QueueTests.Album(1)[0]);
        Assert.Equal(LyricsStatus.Missing, lyrics.Status);

        var view = new LyricsView();
        view.Show(lyrics.Status, lyrics.Doc);
        Assert.Contains(view.GetLogicalDescendants().OfType<TextBlock>(), t => t.Text == "No lyrics found");
    }

    [AvaloniaFact]
    public void UnsyncedLyricsShowAsText()
    {
        var doc = new LyricsDoc("navidrome:t", "none", "fixture", new Attribution("x"),
            [new LyricLine("Line one"), new LyricLine("Line two")]);
        var view = new LyricsView();
        var window = new Window { Content = view };
        window.Show();
        view.Show(LyricsStatus.Ready, doc);
        Dispatcher.UIThread.RunJobs();
        Assert.Contains(view.GetVisualDescendants().OfType<TextBlock>(), t => t.Text == "Line two");
    }

    static double RowLight(WriteableBitmap bitmap, int y)
    {
        using var fb = bitmap.Lock();
        var sum = 0.0;
        unsafe
        {
            var row = (byte*)fb.Address + y * fb.RowBytes;
            for (var x = 0; x < fb.Size.Width; x++) sum += row[x * 4] + row[x * 4 + 1] + row[x * 4 + 2];
        }
        return sum;
    }
}
