using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Threading;
using Avalonia.VisualTree;
using Echo.Ui;

namespace Echo.Tests;

public class SearchQueueWantedTests
{
    const string Search3 = """{"subsonic-response":{"status":"ok","searchResult3":{"song":[],"album":[],"artist":[]}}}""";

    [Fact]
    public async Task SearchDebouncesThenAsksTheServer()
    {
        var routes = new Routes { ["search3"] = Search3 };
        var search = new Searcher(new Library(new Api("https://echo.test", routes)));
        var first = search.Type("n");
        var second = search.Type("ne");
        var result = await search.Type("neo");
        Assert.Null(await first); // superseded while it waited
        Assert.Null(await second);
        Assert.NotNull(result);
        Assert.Single(routes.Asked, p => p.Contains("search3") && p.Contains("query=neo"));
    }

    [AvaloniaFact]
    public void QueueSheetMovesAndRemoves()
    {
        var session = Session.ForFixtures();
        var a = QueueTests.Album(4);
        var x = QueueTests.Album(1, "x")[0];
        session.Player.Show(new QueueState(Now: a[0], NextUp: [x], Context: a.Skip(1).ToList()), TimeSpan.Zero);
        var sheet = new QueueSheet(session);
        var window = new Window { Width = 500, Height = 800, Content = sheet };
        window.Show();
        Assert.Equal(["x0", "a1", "a2", "a3"], session.Player.Queue.Upcoming.Select(t => t.Id));

        sheet.MoveDown(0); // Next up keeps its size: a1 moves up into it
        Assert.Equal(["a1", "x0", "a2", "a3"], session.Player.Queue.Upcoming.Select(t => t.Id));
        sheet.Remove(2);
        Dispatcher.UIThread.RunJobs();
        Assert.Equal(["a1", "x0", "a3"], session.Player.Queue.Upcoming.Select(t => t.Id));
        Assert.Contains(window.GetVisualDescendants().OfType<TextBlock>(), t => t.Text == "Song 3");
        Assert.DoesNotContain(window.GetVisualDescendants().OfType<TextBlock>(), t => t.Text == "Song 2");
    }

    [Fact]
    public async Task WantedRoundTrips()
    {
        var routes = new Routes
        {
            ["GET /wanted"] = """
                [{"id":3,"text":"Mira Vale Low Orbit","addedBy":"ada","addedAt":1762300000000,
                  "found":{"kind":"album","id":"al-9","title":"Low Orbit","artist":"Mira Vale"}},
                 {"id":4,"text":"Ostrava Static Bloom","addedBy":null,"addedAt":1762300001000,"found":null}]
                """,
            ["POST /wanted"] = """{"id":5,"text":"Kai Lumen","addedBy":"ada","addedAt":1762300002000,"found":null}""",
            ["DELETE /wanted/3"] = "{}",
        };
        var wanted = new Wanted(new Api("https://echo.test", routes));

        var list = await wanted.List();
        Assert.Equal("al-9", list[0].Found!.Id);
        Assert.Null(list[1].Found);
        Assert.Null(list[1].AddedBy);
        Assert.Equal(5, (await wanted.Add("Kai Lumen")).Id);
        await wanted.Remove(3);
        Assert.Contains("DELETE /api/v1/wanted/3", routes.Asked);
    }
}
