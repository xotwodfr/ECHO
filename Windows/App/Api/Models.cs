namespace Echo;

// The API's shapes (docs/api/openapi.yaml), as Android's Models.kt has them.

/// The album's palette (VISUALIZER_SPEC.md §6), CSS colours.
public sealed record Palette(
    string Room,
    string Accent,
    string Highlight,
    string Glow,
    string Shadow,
    string? InkActive = null,
    string? Source = null);
