namespace Echo;

/// What miniaudio decodes as stored: FLAC, MP3 and WAV. Everything else (AAC/M4A, Opus, Ogg, WMA) is
/// asked of Navidrome as MP3, 320 kbps.
public static class StreamFormat
{
    static readonly HashSet<string> Raw = ["flac", "mp3", "mpeg", "wav", "wave"];

    /// `type` is a Subsonic suffix ("flac") or a content type ("audio/x-flac").
    public static bool PlaysRaw(string? type)
    {
        if (string.IsNullOrWhiteSpace(type)) return false;
        var t = type.Trim().ToLowerInvariant();
        t = t[(t.LastIndexOf('/') + 1)..];
        if (t.StartsWith("x-")) t = t[2..];
        return Raw.Contains(t);
    }
}
