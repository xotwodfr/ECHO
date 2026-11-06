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
}
