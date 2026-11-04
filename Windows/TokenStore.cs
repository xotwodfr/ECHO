using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Echo;

/// The device token, encrypted for this Windows user (DPAPI) in %LOCALAPPDATA%\ECHO: another user
/// on the computer, or a copy of the file elsewhere, cannot read it.
static class TokenStore
{
    static readonly string TokenFile = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ECHO", "device-token");

    public static string? Load()
    {
        try
        {
            var sealedToken = File.ReadAllBytes(TokenFile);
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(sealedToken, null, DataProtectionScope.CurrentUser));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or CryptographicException)
        {
            return null; // none yet, or unreadable: sign in again
        }
    }

    public static void Save(string token)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(TokenFile)!);
        File.WriteAllBytes(TokenFile, ProtectedData.Protect(Encoding.UTF8.GetBytes(token), null, DataProtectionScope.CurrentUser));
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
