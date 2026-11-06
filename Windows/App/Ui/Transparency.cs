using System.Runtime.InteropServices;
using Microsoft.Win32;
using Echo.Glass;

namespace Echo.Ui;

/// Windows' own look settings the app follows: Transparency effects (off: every glass surface is
/// opaque) and Animation effects (off: reduced motion under Motion → System). Elsewhere both are on.
public static class Transparency
{
    const string Personalize = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

    public static bool Enabled()
    {
        if (!OperatingSystem.IsWindows()) return true;
        using var key = Registry.CurrentUser.OpenSubKey(Personalize);
        return key?.GetValue("EnableTransparency") is not int v || v != 0;
    }

    public static bool AnimationsOn()
    {
        if (!OperatingSystem.IsWindows()) return true;
        var on = 1;
        return !SystemParametersInfo(0x1042 /* SPI_GETCLIENTAREAANIMATION */, 0, ref on, 0) || on != 0;
    }

    /// Brings GlassPanel.Enabled in line with Windows' Transparency effects; true when it changed (the
    /// window's 1 s tick asks, so a change in Settings shows within a second).
    public static bool Sync()
    {
        var on = Enabled();
        if (on == GlassPanel.Enabled) return false;
        GlassPanel.Enabled = on;
        return true;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool SystemParametersInfo(uint action, uint param, ref int value, uint winIni);
}
