using System.Text.Json;

namespace Echo;

/// The window's place: its top-left corner in screen pixels, its size, and whether it was maximized (the
/// size is then the one it goes back to).
public sealed record WindowPlace(int X, int Y, double Width, double Height, bool Maximized);

/// What Settings keeps for this Windows user, beside the device token: Cider's window layout ("mojave",
/// its default, or "maverick"), whether plays scrobble to Navidrome (and on to Last.fm, if it is set
/// up there), and Performance mode (for slower computers: no blur or glow on the lyrics, a still
/// background). And what the window was like when it closed: the volume, its place, and whether the
/// sidebar was shown.
public sealed record Prefs(string Layout = "mojave", bool Scrobble = true, bool Performance = false,
    float Volume = 1, WindowPlace? Window = null, bool Sidebar = true)
{
    public static readonly string File = Path.Combine(TokenStore.Folder, "prefs.json");

    /// The saved prefs, or the defaults (no file, or one that does not read).
    public static Prefs Load(string? file)
    {
        try
        {
            return file is not null && System.IO.File.Exists(file) ? JsonSerializer.Deserialize<Prefs>(System.IO.File.ReadAllText(file), Json.Options) ?? new() : new();
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return new();
        }
    }

    public void Save(string? file)
    {
        if (file is null) return;
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        System.IO.File.WriteAllText(file, JsonSerializer.Serialize(this, Json.Options));
    }
}
