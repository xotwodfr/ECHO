using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace Echo;

/// The API's JSON: camelCase, nulls left out, unknown fields ignored (what the web sends and stores).
public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static T? From<T>(JsonNode? node) => node is null ? default : node.Deserialize<T>(Options);

    public static JsonNode? ToNode<T>(T value) => JsonSerializer.SerializeToNode(value, Options);

    /// A saved queue's position: any JSON number (the web writes fractions of a ms), else 0.
    public static long SavedPositionMs(JsonNode? saved) =>
        saved?["positionMs"] is JsonValue v && v.TryGetValue<double>(out var ms) ? (long)ms : 0;
}
