using CommunityToolkit.Mvvm.ComponentModel;

namespace Echo.Ui;

/// Where the shell is: a page record, and the way back.
public sealed partial class Nav : ObservableObject
{
    readonly Stack<object> back = new();

    [ObservableProperty]
    public partial object Current { get; private set; } = new HomePage();

    public void Go(object page)
    {
        if (Equals(page, Current)) return;
        back.Push(Current);
        Current = page;
    }

    public bool CanGoBack => back.Count > 0;

    public void Back()
    {
        if (back.TryPop(out var page)) Current = page;
    }
}

public sealed record HomePage;

public sealed record SearchPage;

public sealed record AlbumsPage;

public sealed record AlbumPage(Album Album);

public sealed record ArtistsPage;

public sealed record ArtistPage(string Id, string Name);

public sealed record PlaylistsPage;

public sealed record PlaylistPage(string Id, string Name);

public sealed record StarredPage;

public sealed record MixPage(Mix Mix);

public sealed record WantedPage;

public sealed record ListenPage;
