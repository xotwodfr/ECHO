using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Echo.Ui;

namespace Echo.Tests;

// PRODUCT_SPEC.md §7, the keyboard map.
public class ShortcutTests
{
    [Fact]
    public void SpaceTogglesOutsideTextFields()
    {
        var keys = new Shortcuts(() => 0);
        Assert.Equal(ShortcutAction.TogglePlay, keys.Map(Key.Space, KeyModifiers.None, textFocused: false));
        Assert.Null(keys.Map(Key.Space, KeyModifiers.None, textFocused: true));
    }

    [Fact]
    public void NothingButEscapeFiresInATextField()
    {
        var keys = new Shortcuts(() => 0);
        Assert.Null(keys.Map(Key.K, KeyModifiers.Control, textFocused: true));
        Assert.Null(keys.Map(Key.Right, KeyModifiers.None, textFocused: true));
        Assert.Equal(ShortcutAction.Escape, keys.Map(Key.Escape, KeyModifiers.None, textFocused: true));
    }

    [Fact]
    public void GThenLGoesToTheLibraryWithinASecond()
    {
        var t = 0.0;
        var keys = new Shortcuts(() => t);
        Assert.Null(keys.Map(Key.G, KeyModifiers.None, false));
        t = 500;
        Assert.Equal(ShortcutAction.GoLibrary, keys.Map(Key.L, KeyModifiers.None, false));
        Assert.Null(keys.Map(Key.G, KeyModifiers.None, false));
        t = 1700;
        Assert.Equal(ShortcutAction.ToggleLyrics, keys.Map(Key.L, KeyModifiers.None, false)); // too late: L alone
    }

    [Fact]
    public void ArrowsSeekAndSkip()
    {
        var keys = new Shortcuts(() => 0);
        Assert.Equal(ShortcutAction.SeekForward5, keys.Map(Key.Right, KeyModifiers.None, false));
        Assert.Equal(ShortcutAction.SeekBack15, keys.Map(Key.Left, KeyModifiers.Shift, false));
        Assert.Equal(ShortcutAction.Next, keys.Map(Key.Right, KeyModifiers.Control, false));
        Assert.Equal(ShortcutAction.ShortcutSheet, keys.Map(Key.OemQuestion, KeyModifiers.Shift, false));
        Assert.Equal(ShortcutAction.Search, keys.Map(Key.OemQuestion, KeyModifiers.None, false));
    }

    [AvaloniaFact]
    public void BracketsMoveTheOffsetBy50()
    {
        var session = Session.ForFixtures();
        var shell = new Shell(session);
        var window = new Window { Content = shell };
        window.Show();
        shell.Do(ShortcutAction.OffsetLater);
        shell.Do(ShortcutAction.OffsetLater);
        shell.Do(ShortcutAction.OffsetEarlier);
        Assert.Equal(50, session.Prefs.State.LyricOffsetMs);
    }
}
