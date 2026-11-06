using Avalonia.Input;

namespace Echo.Ui;

public enum ShortcutAction
{
    TogglePlay, SeekBack5, SeekForward5, SeekBack15, SeekForward15, Previous, Next, VolumeUp, VolumeDown, Mute,
    ToggleLyrics, CycleView, CoverMode, ToggleQueue, Search, GoLibrary, GoSettings, GoListen, FullScreen,
    OffsetEarlier, OffsetLater, Shuffle, Repeat, ShortcutSheet, Escape,
}

/// The keyboard map (PRODUCT_SPEC.md §7). The differences from the web: F and F11 are the window's full
/// screen, and [ / ] move the timing offset for all tracks (the per-track nudge stays on the web).
/// Nothing fires while a text field has the focus, except Esc. G then L / S / P is a chord within 1 s.
public sealed class Shortcuts(Func<double> nowMs)
{
    const double ChordMs = 1000;
    double gAt = double.NegativeInfinity;

    /// What the shown sheet lists (`?`), key and what it does.
    public static readonly (string Keys, string What)[] Sheet =
    [
        ("Space", "Play / pause"),
        ("← / →", "Seek −5 s / +5 s (Shift: 15 s)"),
        ("Ctrl + ← / →", "Previous / next track"),
        ("↑ / ↓", "Volume +5% / −5%"),
        ("M", "Mute"),
        ("L", "Toggle lyrics view"),
        ("V", "Cycle stage view: Lyrics → Cover → Visual"),
        ("C", "Cover mode"),
        ("Q", "Toggle queue sheet"),
        ("/ or Ctrl + K", "Search"),
        ("G then L / S / P", "Go to Library / Settings / Listen"),
        ("F or F11", "Full screen"),
        ("[ / ]", "Lyric timing −50 ms / +50 ms"),
        ("S · R", "Toggle shuffle · cycle repeat"),
        ("?", "Shortcut sheet"),
        ("Esc", "Close the top overlay, or exit full screen"),
    ];

    public ShortcutAction? Map(Key key, KeyModifiers mods, bool textFocused)
    {
        if (key == Key.Escape) return ShortcutAction.Escape;
        if (textFocused) return null;
        var ctrl = mods.HasFlag(KeyModifiers.Control);
        var shift = mods.HasFlag(KeyModifiers.Shift);
        if (nowMs() - gAt <= ChordMs)
        {
            gAt = double.NegativeInfinity;
            switch (key)
            {
                case Key.L: return ShortcutAction.GoLibrary;
                case Key.S: return ShortcutAction.GoSettings;
                case Key.P: return ShortcutAction.GoListen;
            }
        }
        switch (key)
        {
            case Key.G when !ctrl:
                gAt = nowMs();
                return null;
            case Key.Space: return ShortcutAction.TogglePlay;
            case Key.Left: return ctrl ? ShortcutAction.Previous : shift ? ShortcutAction.SeekBack15 : ShortcutAction.SeekBack5;
            case Key.Right: return ctrl ? ShortcutAction.Next : shift ? ShortcutAction.SeekForward15 : ShortcutAction.SeekForward5;
            case Key.Up: return ShortcutAction.VolumeUp;
            case Key.Down: return ShortcutAction.VolumeDown;
            case Key.M: return ShortcutAction.Mute;
            case Key.L: return ShortcutAction.ToggleLyrics;
            case Key.V: return ShortcutAction.CycleView;
            case Key.C: return ShortcutAction.CoverMode;
            case Key.Q: return ShortcutAction.ToggleQueue;
            case Key.K when ctrl: return ShortcutAction.Search;
            case Key.OemQuestion: return shift ? ShortcutAction.ShortcutSheet : ShortcutAction.Search;
            case Key.F: return ShortcutAction.FullScreen;
            case Key.OemOpenBrackets: return ShortcutAction.OffsetEarlier;
            case Key.OemCloseBrackets: return ShortcutAction.OffsetLater;
            case Key.S: return ShortcutAction.Shuffle;
            case Key.R: return ShortcutAction.Repeat;
            default: return null;
        }
    }
}
