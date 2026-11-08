namespace Echo;

/// An error nothing caught, written down before the app closes, for the owner to send: crash.log beside the
/// device token (%LOCALAPPDATA%\ECHO), with the time and the version, added to (and started again past 1 MB).
static class CrashLog
{
    public static readonly string File = Path.Combine(TokenStore.Folder, "crash.log");

    public static void Write(Exception e, string file)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            if (System.IO.File.Exists(file) && new FileInfo(file).Length > 1024 * 1024) System.IO.File.Delete(file);
            System.IO.File.AppendAllText(file, $"{DateTime.UtcNow:u} ECHO {typeof(CrashLog).Assembly.GetName().Version}\n{e}\n\n");
        }
        catch (Exception x) when (x is IOException or UnauthorizedAccessException) { } // closing anyway
    }
}
