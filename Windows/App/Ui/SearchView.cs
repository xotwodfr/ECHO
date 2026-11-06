using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace Echo.Ui;

/// Search as you type: the server is asked 250 ms after the typing stops (search3).
public sealed class Searcher(Library library, Func<TimeSpan, CancellationToken, Task>? wait = null)
{
    CancellationTokenSource? pending;

    /// The results for `q`, or null when newer typing superseded it.
    public async Task<SearchResult?> Type(string q)
    {
        pending?.Cancel();
        var cts = pending = new CancellationTokenSource();
        try
        {
            await (wait ?? Task.Delay)(TimeSpan.FromMilliseconds(250), cts.Token);
        }
        catch (OperationCanceledException)
        {
            return null;
        }
        if (string.IsNullOrWhiteSpace(q)) return new SearchResult([], [], []);
        var result = await library.Search(q.Trim());
        return cts.IsCancellationRequested ? null : result;
    }
}

/// The search page (PRODUCT_SPEC.md S3): songs, albums and artists; with nothing found, Add to Wanted and
/// the same search on YouTube Music (a link out: ECHO's YouTube Music mode is not in this app).
public sealed class SearchView : UserControl
{
    readonly Session s;
    readonly Searcher searcher;
    readonly TextBox box;
    readonly StackPanel results = new();
    readonly TextBlock status = Page.Note();

    public SearchView(Session session)
    {
        s = session;
        searcher = new Searcher(s.Library);
        box = new TextBox
        {
            PlaceholderText = "What do you want to play?", FontSize = 18, Height = 48, MaxWidth = 560, Margin = new Thickness(8, 0, 0, 20),
            HorizontalAlignment = HorizontalAlignment.Left, VerticalContentAlignment = VerticalAlignment.Center, CornerRadius = new CornerRadius(24),
            Padding = new Thickness(20, 0), MinWidth = 420,
        };
        box.TextChanged += (_, _) => _ = Search(box.Text ?? "");
        var column = new StackPanel { Children = { Page.Title("Search"), box, status, results } };
        Content = Page.Scroll(column);
        AttachedToVisualTree += (_, _) => box.Focus();
    }

    async Task Search(string q)
    {
        SearchResult? r = null;
        await Page.Load(s, status, async () => r = await searcher.Type(q));
        if (r is null) return;
        status.IsVisible = false;
        results.Children.Clear();
        if (string.IsNullOrWhiteSpace(q)) return;
        if (r.Tracks.Count + r.Albums.Count + r.Artists.Count == 0)
        {
            results.Children.Add(Page.Note($"No results for “{q.Trim()}”."));
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Margin = new Thickness(8, 8, 0, 0) };
            row.Children.Add(Page.Primary("Add to Wanted", () => _ = AddWanted(q)));
            row.Children.Add(Link("Search YouTube Music", $"https://music.youtube.com/search?q={Uri.EscapeDataString(q.Trim())}"));
            results.Children.Add(row);
            return;
        }
        if (r.Tracks.Count > 0)
        {
            results.Children.Add(Page.Heading("Songs"));
            results.Children.Add(new TrackList(s, r.Tracks, new PlayContext("search", null, q.Trim())));
        }
        if (r.Albums.Count > 0)
        {
            results.Children.Add(Page.Heading("Albums"));
            results.Children.Add(Page.Cards(r.Albums.Select(a => Page.AlbumCard(s, a))));
        }
        if (r.Artists.Count > 0)
        {
            results.Children.Add(Page.Heading("Artists"));
            results.Children.Add(Page.Cards(r.Artists.Select(a => new Card(a.Name, null, a.Image, () => s.Nav.Go(new ArtistPage(a.Id, a.Name)), Round: true))));
        }
    }

    async Task AddWanted(string q)
    {
        await Page.Load(s, status, async () =>
        {
            await new Wanted(s.Api).Add(q);
            s.Player.Notice = "Added to Wanted";
        });
    }

    Button Link(string text, string url)
    {
        var b = new Button { Theme = Page.Bare, Content = text, Padding = new Thickness(16, 8), CornerRadius = new CornerRadius(18), FontWeight = FontWeight.SemiBold, BorderBrush = new SolidColorBrush(Color.Parse("#40FFFFFF")), BorderThickness = new Thickness(1) };
        b.Click += (_, _) => _ = TopLevel.GetTopLevel(this)?.Launcher.LaunchUriAsync(new Uri(url));
        return b;
    }
}
