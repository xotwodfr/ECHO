using Avalonia;
using Avalonia.Animation;
using Avalonia.Animation.Easings;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Media.Transformation;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace Echo.Ui;

/// The app's motion (Cider's wpfade and appleEase, Apple Music's settle): things come in from a little
/// way off, fading; lists cascade; the wheel glides.
public static class Motion
{
    public static readonly Easing Out = new CubicEaseOut();

    /// Comes in from (dx, dy) px away and transparent, over `ms`, after `delay` ms.
    public static void Enter(Control c, double dx = 0, double dy = 12, int ms = 260, int delay = 0)
    {
        c.Opacity = 0;
        c.RenderTransform = TransformOperations.Parse($"translate({dx}px, {dy}px)");
        c.Transitions =
        [
            new DoubleTransition { Property = Visual.OpacityProperty, Duration = TimeSpan.FromMilliseconds(ms), Easing = Out },
            new TransformOperationsTransition { Property = Visual.RenderTransformProperty, Duration = TimeSpan.FromMilliseconds(ms), Easing = Out },
        ];
        void Go()
        {
            c.Opacity = 1;
            c.RenderTransform = TransformOperations.Parse("translate(0px, 0px)");
        }
        if (delay <= 0) Dispatcher.UIThread.Post(Go, DispatcherPriority.Render);
        else DispatcherTimer.RunOnce(Go, TimeSpan.FromMilliseconds(delay));
    }

    /// The `index`th item of a list coming in: 20 ms after the one before, the first 24 only.
    public static void Cascade(Control c, int index, double dy = 10)
    {
        if (index < 24) Enter(c, 0, dy, 300, index * 20);
    }

    /// Every scroll viewer glides to where the wheel sends it instead of jumping (a frame-rate-free ease,
    /// 90 ms to cover most of the way), the innermost one that can move along the wheel's way taking it.
    public static void SmoothScrolling() =>
        InputElement.PointerWheelChangedEvent.AddClassHandler<ScrollViewer>(Wheel, RoutingStrategies.Tunnel);

    static readonly Dictionary<ScrollViewer, Vector> targets = [];

    static void Wheel(ScrollViewer viewer, PointerWheelEventArgs e)
    {
        if (e.Handled || e.KeyModifiers != KeyModifiers.None || e.Delta.Y == 0) return;
        var inner = (e.Source as Visual)?.GetSelfAndVisualAncestors().OfType<ScrollViewer>().FirstOrDefault(CanScroll);
        if (inner != viewer) return; // a viewer nearer the pointer (or none) takes it
        e.Handled = true;
        var max = Math.Max(0, viewer.Extent.Height - viewer.Viewport.Height);
        var from = targets.TryGetValue(viewer, out var t) ? t : viewer.Offset;
        var to = new Vector(viewer.Offset.X, Math.Clamp(from.Y - e.Delta.Y * 110, 0, max));
        var running = targets.ContainsKey(viewer);
        targets[viewer] = to;
        if (running || TopLevel.GetTopLevel(viewer) is not { } top) return;
        var last = TimeSpan.Zero;
        top.RequestAnimationFrame(Frame);
        void Frame(TimeSpan at)
        {
            var dt = last == TimeSpan.Zero ? 16 : Math.Min(100, (at - last).TotalMilliseconds);
            last = at;
            if (!targets.TryGetValue(viewer, out var goal)) return;
            var y = viewer.Offset.Y + (goal.Y - viewer.Offset.Y) * (1 - Math.Exp(-dt / 90));
            if (Math.Abs(goal.Y - y) < 0.5) y = goal.Y;
            viewer.Offset = new Vector(viewer.Offset.X, y);
            if (y == goal.Y || TopLevel.GetTopLevel(viewer) is null) targets.Remove(viewer);
            else top.RequestAnimationFrame(Frame);
        }
    }

    static bool CanScroll(ScrollViewer v) =>
        v.VerticalScrollBarVisibility != ScrollBarVisibility.Disabled && v.Extent.Height > v.Viewport.Height + 1;

    /// Glides a viewer sideways to `x` (a shelf's arrows).
    public static void GlideX(ScrollViewer viewer, double x)
    {
        if (TopLevel.GetTopLevel(viewer) is not { } top) return;
        var last = TimeSpan.Zero;
        top.RequestAnimationFrame(Frame);
        void Frame(TimeSpan at)
        {
            var dt = last == TimeSpan.Zero ? 16 : Math.Min(100, (at - last).TotalMilliseconds);
            last = at;
            var now = viewer.Offset.X + (x - viewer.Offset.X) * (1 - Math.Exp(-dt / 110));
            if (Math.Abs(x - now) < 0.5) now = x;
            viewer.Offset = new Vector(now, viewer.Offset.Y);
            if (now != x) top.RequestAnimationFrame(Frame);
        }
    }
}
