using Echo.Stage;

namespace Echo.Tests;

// The room's shaders are Android's assets, which are the web's (src/client/stage/android-shaders.test.ts):
// the exe embeds them from there, so a shader change reaches all three.
public class ShaderTests
{
    [Theory]
    [InlineData("fullscreen_vert")]
    [InlineData("room_frag")]
    [InlineData("energy_frag")]
    [InlineData("composite_frag")]
    [InlineData("probe_frag")]
    public void EveryStageShaderIsEmbedded(string name) =>
        Assert.Equal(File.ReadAllText(Path.Combine(Repo.Root, "Android/app/src/main/assets/stage", $"{name}.glsl")),
            StageRenderer.Source(name));
}

static class Repo
{
    public static readonly string Root = Find(AppContext.BaseDirectory);

    static string Find(string dir) =>
        Directory.Exists(Path.Combine(dir, "Android")) && Directory.Exists(Path.Combine(dir, "Windows"))
            ? dir
            : Find(Path.GetDirectoryName(dir) ?? throw new DirectoryNotFoundException("the repository root"));
}
