using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Echo.Glass;
using Echo.Stage;

namespace Echo.Ui;

/// The Listen room, for now the room alone (the lyric field and its chrome come next): the GL room over
/// its Skia fallback, and a glass way back.
public sealed class ListenView : Panel
{
    public ListenView(Session session)
    {
        var palette = session.Fixtures ? Fixtures.Palette : StagePalette.Fallback;
        var stage = new StageView(session.Tap)
        {
            Mode = session.Fixtures ? RoomMode.Ambient : RoomMode.Reverb,
            Palette = palette,
            Playing = session.Player.Playing,
        };
        stage.TrackStarted();
        session.Player.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Playback.Player.Playing)) stage.Playing = session.Player.Playing;
        };
        var app = Application.Current!;
        var back = new Button
        {
            Theme = (Avalonia.Styling.ControlTheme)app.FindResource("Bare")!,
            Width = 44,
            Height = 44,
            CornerRadius = new CornerRadius(22),
            Content = new PathIcon { Data = (StreamGeometry)app.FindResource("IconBack")!, Width = 18, Height = 18 },
        };
        back.Click += (_, _) => session.Nav.Back();
        Children.Add(new FallbackRoom { Palette = palette });
        Children.Add(stage);
        Children.Add(new GlassPanel
        {
            Width = 44,
            Height = 44,
            CornerRadius = new CornerRadius(22),
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            Margin = new Thickness(20),
            Child = back,
        });
    }
}
