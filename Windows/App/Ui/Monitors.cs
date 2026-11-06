using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Controls;

namespace Echo.Ui;

/// Which monitor the room goes full screen on: the one that holds the remembered point, else the
/// primary (it was unplugged, or a game changed the layout).
public static class Monitors
{
    public static int Pick(IReadOnlyList<(PixelRect Bounds, bool Primary)> all, PixelPoint? remembered)
    {
        if (remembered is { } p)
            for (var i = 0; i < all.Count; i++)
                if (all[i].Bounds.Contains(p)) return i;
        for (var i = 0; i < all.Count; i++)
            if (all[i].Primary) return i;
        return 0;
    }
}

/// The Listen room's chrome: it hides after 3 s of play without a pointer move or a key (as on the web
/// and Android), and stays while paused.
public sealed class ChromeTimer(Func<double> nowMs)
{
    const double HideAfterMs = 3000;
    double poked = nowMs();

    public void Poke() => poked = nowMs();

    public bool Visible(bool playing) => !playing || nowMs() - poked < HideAfterMs;
}

/// Whether anyone can see the window: the room and the lyrics draw only then. Minimised, or covered
/// whole by another window (a full-screen game on the same monitor), they stop; audio and the media
/// controls go on.
public static class Seen
{
    public static bool Allowed { get; private set; } = true;

    /// Drawing may start again: views that stopped asking for frames ask again.
    public static event Action? Resumed;

    public static void Update(Window window)
    {
        var allowed = window.WindowState != WindowState.Minimized && !(OperatingSystem.IsWindows() && Covered(window));
        if (allowed == Allowed) return;
        Allowed = allowed;
        if (allowed) Resumed?.Invoke();
    }

    // ponytail: a 5-point sample of the client area (its centre and inset corners) for the topmost
    // window; a real occlusion region if it ever misjudges a partly covered window.
    static bool Covered(Window window)
    {
        if (window.TryGetPlatformHandle()?.Handle is not { } hwnd || hwnd == 0) return false;
        if (DwmGetWindowAttribute(hwnd, 14 /* DWMWA_CLOAKED */, out var cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
        if (!GetClientRect(hwnd, out var r)) return false;
        var origin = new Point32(0, 0);
        ClientToScreen(hwnd, ref origin);
        int w = r.Right - r.Left, h = r.Bottom - r.Top;
        Point32[] points =
        [
            new(origin.X + w / 2, origin.Y + h / 2), new(origin.X + 8, origin.Y + 8), new(origin.X + w - 8, origin.Y + 8),
            new(origin.X + 8, origin.Y + h - 8), new(origin.X + w - 8, origin.Y + h - 8),
        ];
        return points.All(p => GetAncestor(WindowFromPoint(p), 2 /* GA_ROOT */) != hwnd);
    }

    [StructLayout(LayoutKind.Sequential)]
    record struct Point32(int X, int Y);

    [StructLayout(LayoutKind.Sequential)]
    record struct Rect32(int Left, int Top, int Right, int Bottom);

    [DllImport("user32.dll")]
    static extern nint WindowFromPoint(Point32 p);

    [DllImport("user32.dll")]
    static extern nint GetAncestor(nint hwnd, uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetClientRect(nint hwnd, out Rect32 rect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool ClientToScreen(nint hwnd, ref Point32 point);

    [DllImport("dwmapi.dll")]
    static extern int DwmGetWindowAttribute(nint hwnd, int attribute, out int value, int size);
}
