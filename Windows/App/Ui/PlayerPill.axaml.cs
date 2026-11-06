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
        Shuffle.Click += (_, _) => now.SetShuffle(!now.Queue.Shuffle);
        Repeat.Click += (_, _) => now.CycleRepeat();
        QueueButton.Click += (_, _) => session.ToggleQueue();
        now.QueueChanged += ShowModes;
        ShowModes();
        now.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Playing)) ShowPlaying(now.Playing);
            if (e.PropertyName == nameof(Player.Notice)) ShowNotice(now);
        };
        ShowPlaying(now.Playing);
    }

    /// Shuffle and repeat lit when on; repeat one marked 1.
    void ShowModes()
    {
        if (DataContext is not Player p) return;
        Shuffle.Opacity = p.Queue.Shuffle ? 1 : 0.5;
        Repeat.Opacity = p.Queue.Repeat == Playback.Repeat.Off ? 0.5 : 1;
        RepeatOne.IsVisible = p.Queue.Repeat == Playback.Repeat.One;
    }

    void ShowNotice(Player p)
    {
        Toast.IsVisible = p.Notice is not null;
        ToastText.Text = p.Notice;
        if (p.Notice is not { } shown) return;
        Avalonia.Threading.DispatcherTimer.RunOnce(() =>
        {
            if (p.Notice == shown) p.Notice = null;
        }, TimeSpan.FromSeconds(4));
    }

    void ShowPlaying(bool playing) =>
        ToggleIcon.Data = (StreamGeometry)Application.Current!.FindResource(playing ? "IconPause" : "IconPlay")!;
}
