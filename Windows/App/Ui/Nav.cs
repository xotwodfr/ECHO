using CommunityToolkit.Mvvm.ComponentModel;

namespace Echo.Ui;

/// Where the shell is: a page record, and the way back.
public sealed partial class Nav : ObservableObject
{
    readonly Stack<object> back = new();

    [ObservableProperty]
    public partial object Current { get; private set; } = new AlbumsPage();

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

public sealed record AlbumsPage;

public sealed record AlbumPage(Album Album);

public sealed record ListenPage;
