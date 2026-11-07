using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Echo.Playback;

namespace Echo.Ui;

/// The flowing background behind the full-screen lyrics (Spicy Lyrics' dynamic background: the cover
/// warped and blurred, `saturate(2.5) brightness(0.65)`): the cover blurred once, three copies turning
/// slowly at different speeds around different points, so the colours drift. Only transforms move each
/// frame (no live blur), and only while the song plays.
public sealed class FluidBackground : Control
{
    static readonly Dictionary<string, Bitmap?> baked = [];
    static readonly IBrush Shade = new SolidColorBrush(Color.FromArgb(40, 0, 0, 0));
    readonly Session session;
    string? url;
    Bitmap? image;
    double seconds;
    bool scheduled;

    public FluidBackground(Session session)
    {
        this.session = session;
        PropertyChangedEventHandler follow = (_, e) =>
        {
            if (e.PropertyName == nameof(Player.Track)) _ = Load(session.Player.Track?.Cover);
            if (e.PropertyName == nameof(Player.Playing)) Wake();
        };
        this.WhileShown(() =>
        {
            session.Player.PropertyChanged += follow;
            _ = Load(session.Player.Track?.Cover);
            Wake();
        }, () => session.Player.PropertyChanged -= follow);
    }

    async Task Load(string? which)
    {
        if (which == url && image is not null) return;
        url = which;
        if (which is null || Session.Current is not { } s) return;
        if (!baked.TryGetValue(which, out var done))
        {
            var cover = await s.Covers.Get(which, 300);
            done = baked[which] = cover is null ? null : ArtworkMaterial.Bake(cover, sigma: 6, saturate: 2.5f, brightness: 0.65f);
        }
        if (which != url) return;
        image = done;
        InvalidateVisual();
    }

    void Wake()
    {
        if (scheduled || TopLevel.GetTopLevel(this) is not { } top) return;
        scheduled = true;
        var last = TimeSpan.Zero;
        top.RequestAnimationFrame(Frame);
        void Frame(TimeSpan at)
        {
            seconds += last == TimeSpan.Zero ? 0 : Math.Min(0.1, (at - last).TotalSeconds);
            last = at;
            InvalidateVisual();
            if (session.Player.Playing && TopLevel.GetTopLevel(this) is not null) top.RequestAnimationFrame(Frame);
            else scheduled = false;
        }
    }

    public override void Render(DrawingContext context)
    {
        var box = new Rect(Bounds.Size);
        if (image is null || box.Width < 1) return;
        var big = Math.Max(box.Width, box.Height);
        var src = new Rect(image.Size);
        // (scale of the longer side, turns per minute, the turning point as a fraction of the box, opacity)
        (double Scale, double Rpm, double X, double Y, double Opacity)[] layers =
            [(2.2, 0.9, 0.3, 0.35, 1), (1.7, -1.3, 0.75, 0.6, 0.55), (1.3, 1.7, 0.5, 0.85, 0.45)];
        using (context.PushClip(box))
            foreach (var l in layers)
            {
                var side = big * l.Scale;
                var turn = Matrix.CreateRotation(seconds / 60 * l.Rpm * 2 * Math.PI);
                var at = new Point(box.Width * l.X, box.Height * l.Y);
                using (context.PushTransform(Matrix.CreateTranslation(-side / 2, -side / 2) * turn * Matrix.CreateTranslation(at.X, at.Y)))
                using (context.PushOpacity(l.Opacity))
                    context.DrawImage(image, src, new Rect(0, 0, side, side));
            }
        context.FillRectangle(Shade, box);
    }
}
