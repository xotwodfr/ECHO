using System.Text.Json;

namespace Echo;

/// What Settings keeps for this Windows user, beside the device token: Cider's window layout ("mojave",
/// its default, or "maverick") and whether plays scrobble to Navidrome (and on to Last.fm, if it is set
/// up there).
public sealed record Prefs(string Layout = "mojave", bool Scrobble = true)
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
