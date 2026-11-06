using Avalonia.Controls;
using Avalonia.Interactivity;

namespace Echo.Ui;

public sealed record SongRow(int Number, Song Song, int Index)
{
    public string Time => $"{Song.Seconds / 60}:{Song.Seconds % 60:00}";
}

/// An album: its cover, its songs; a song plays the album from there on.
public partial class AlbumView : UserControl
{
    readonly Session session;
    readonly Album album;
    IReadOnlyList<Song> songs = [];

    public AlbumView() : this(Session.ForFixtures(), Fixtures.Albums[0]) { } // the XAML previewer

    public AlbumView(Session session, Album album)
    {
        this.session = session;
        this.album = album;
        InitializeComponent();
        Cover.CoverArt = album.CoverArt;
        Title.Text = album.Name;
        Artist.Text = album.Artist;
        PlayAll.Click += (_, _) => { if (songs.Count > 0) _ = session.Now.Play(album, songs, 0); };
        _ = Load();
    }

    async Task Load()
    {
        try
        {
            songs = await session.Songs(album);
            Songs.ItemsSource = songs.Select((s, i) => new SongRow(i + 1, s, i)).ToList();
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

    void Play(object? sender, RoutedEventArgs e)
    {
        if (sender is Button { Tag: SongRow row }) _ = session.Now.Play(album, songs, row.Index);
    }
}
