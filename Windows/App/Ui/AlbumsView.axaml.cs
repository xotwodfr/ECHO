using Avalonia.Controls;
using Avalonia.Interactivity;

namespace Echo.Ui;

/// Your albums, A–Z, as covers.
public partial class AlbumsView : UserControl
{
    readonly Session session;

    public AlbumsView() : this(Session.ForFixtures()) { } // the XAML previewer

    public AlbumsView(Session session)
    {
        this.session = session;
        InitializeComponent();
        _ = Load();
    }

    async Task Load()
    {
        try
        {
            Grid.ItemsSource = await session.Albums();
        }
        catch (ApiException e) when (e.SignedOut)
        {
            session.Refused();
        }
        catch (Exception e) when (e is HttpRequestException or ApiException or TaskCanceledException)
        {
            Status.Text = "Can't reach the server.";
            Status.IsVisible = true;
        }
    }

    void Open(object? sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: Album album }) session.Nav.Go(new AlbumPage(album));
    }
}
