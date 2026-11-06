using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Echo.Playback;

namespace Echo.Ui;

/// The floating glass player: what plays, how far, and the transport. Its cover and title open the
/// Listen room.
public partial class PlayerPill : UserControl
{
    public PlayerPill() => InitializeComponent();

    public void Bind(Session session)
    {
        var now = session.Player;
        DataContext = now;
        Open.Click += (_, _) => session.Nav.Go(new ListenPage());
        Previous.Click += (_, _) => _ = now.Previous();
        Next.Click += (_, _) => _ = now.Next();
        Toggle.Click += (_, _) => now.Toggle();
        now.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Playing)) ShowPlaying(now.Playing);
        };
        ShowPlaying(now.Playing);
    }

    void ShowPlaying(bool playing) =>
        ToggleIcon.Data = (StreamGeometry)Application.Current!.FindResource(playing ? "IconPause" : "IconPlay")!;
}
