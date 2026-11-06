using System.Text.Json;
using Echo.Stage;

namespace Echo;

// Preferences (src/client/prefs.ts, SETTINGS_AND_SECURITY.md §7.1; Android's Prefs.kt), the web's
// defaults, on this computer; and where the window was (the monitor ECHO goes back to).

public enum VisualMode { Auto, Reverb, Ambient, Still }

public enum Motion { System, Full, Reduced, Off }

public enum Quality { Auto, High, Balanced, Low, Minimal }

public sealed record Prefs(
    VisualMode Mode = VisualMode.Auto,
    Intensity Intensity = Intensity.Expressive,
    Quality Quality = Quality.Auto,
    Motion Motion = Motion.System,
    float Backdrop = 0.5f, // the room's blurred-cover brightness
    float LyricScale = 1f,
    long LyricOffsetMs = 0,
    bool ShowUnsynced = true,
    bool Scrobble = true,
    int? WindowX = null, // the window's centre when it last closed or went full screen, physical px
    int? WindowY = null,
    bool FullScreen = false);

/// The preferences, kept as JSON next to the device token (none: in memory only, the fixtures).
public sealed class PrefsStore(string? file)
{
    public static string DefaultFile => OperatingSystem.IsWindows()
        ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ECHO", "prefs.json")
        : Path.Combine(Environment.GetEnvironmentVariable("XDG_STATE_HOME") is { Length: > 0 } state
            ? state
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "state"), "echo-windows", "prefs.json");

    public Prefs State { get; private set; } = Read(file);

    public event Action<Prefs>? Changed;

    static Prefs Read(string? file)
    {
        try
        {
            return file is not null && File.Exists(file) ? JsonSerializer.Deserialize<Prefs>(File.ReadAllText(file), Json.Options) ?? new Prefs() : new Prefs();
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return new Prefs(); // unreadable: the defaults
        }
    }

    public void Update(Func<Prefs, Prefs> f)
    {
        State = f(State);
        if (file is not null)
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(file)!);
                File.WriteAllText(file, JsonSerializer.Serialize(State, Json.Options));
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { } // kept for this run
        Changed?.Invoke(State);
    }

    /// Reduced motion: the setting, or Windows' "Animation effects" under System.
    public bool ReducedMotion => State.Motion switch
    {
        Motion.Reduced or Motion.Off => true,
        Motion.Full => false,
        _ => !Ui.Transparency.AnimationsOn(),
    };
}
