using System.Security.Cryptography;
using System.Text;

namespace Echo;

/// The device token. On Windows it is encrypted for this Windows user (DPAPI) in %LOCALAPPDATA%\ECHO:
/// another user on the computer, or a copy of the file elsewhere, cannot read it. On the Linux dev
/// box it is a file only its owner can read, under $XDG_STATE_HOME.
static class TokenStore
{
    /// This user's ECHO folder (the prefs live there too).
    public static readonly string Folder = OperatingSystem.IsWindows()
        ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ECHO")
        : Path.Combine(Environment.GetEnvironmentVariable("XDG_STATE_HOME") is { Length: > 0 } state
            ? state
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "state"),
            "echo-windows");

    static readonly string TokenFile = Path.Combine(Folder, OperatingSystem.IsWindows() ? "device-token" : "token");

    public static string? Load()
    {
        try
        {
            var stored = File.ReadAllBytes(TokenFile);
            return Encoding.UTF8.GetString(OperatingSystem.IsWindows()
                ? ProtectedData.Unprotect(stored, null, DataProtectionScope.CurrentUser)
                : stored);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or CryptographicException)
        {
            return null; // none yet, or unreadable: sign in again
        }
    }

    public static void Save(string token)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(TokenFile)!);
        var bytes = Encoding.UTF8.GetBytes(token);
        if (OperatingSystem.IsWindows())
        {
            File.WriteAllBytes(TokenFile, ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser));
            return;
        }
        File.WriteAllBytes(TokenFile, []);
        File.SetUnixFileMode(TokenFile, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        File.WriteAllBytes(TokenFile, bytes);
    }

    public static void Forget()
    {
        try
        {
            File.Delete(TokenFile);
        }
        catch (IOException) { }
    }
}
