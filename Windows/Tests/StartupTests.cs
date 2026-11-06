using Avalonia.Headless.XUnit;
using Echo.Ui;

namespace Echo.Tests;

public class StartupTests
{
    [AvaloniaFact]
    public void MainWindowOpens()
    {
        var window = new MainWindow();
        window.Show();
        Assert.Equal("ECHO", window.Title);
        Assert.Equal(1024, window.MinWidth);
    }
}
