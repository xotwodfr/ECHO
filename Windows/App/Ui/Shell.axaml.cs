using Avalonia.Controls;

namespace Echo.Ui;

/// The signed-in window: the page Nav points at, under the glass.
public partial class Shell : UserControl
{
    readonly Session session;

    public Shell() : this(Session.ForFixtures()) { } // the XAML previewer

    public Shell(Session session)
    {
        this.session = session;
        InitializeComponent();
        PlayerPill.Bind(session);
        LibraryButton.Click += (_, _) => session.Nav.Go(new AlbumsPage());
        Initial.Text = session.Fixtures ? "F" : "";
        session.Nav.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Nav.Current)) Show(session.Nav.Current);
        };
        Show(session.Nav.Current);
        _ = session.Player.Restore(); // the queue from another device, paused
    }

    void Show(object page)
    {
        var listen = page is ListenPage;
        // The Listen room has no sidebar and no capsules (the web's Stage); the pill stays for now.
        Sidebar.IsVisible = !listen;
        SearchCapsule.IsVisible = !listen;
        Account.IsVisible = !listen;
        PlayerPill.IsVisible = !listen;
        Page.Content = page switch
        {
            AlbumPage a => new AlbumView(session, a.Album),
            ListenPage => new ListenView(session),
            _ => new AlbumsView(session),
        };
    }
}
