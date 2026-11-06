using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Echo.Glass;

namespace Echo.Ui;

/// The queue (PRODUCT_SPEC.md S4), a glass sheet at the right over any page: what plays, Next up, then
/// the rest of where it plays from; each song moves up or down, goes, or plays now. Clear queue keeps
/// what plays.
public sealed class QueueSheet : GlassPanel
{
    readonly Session s;
    readonly StackPanel list = new() { Spacing = 0 };

    public QueueSheet(Session session)
    {
        s = session;
        Name = "Queue";
        Width = 380;
        CornerRadius = new CornerRadius(22);
        Margin = new Thickness(12, 12, 12, 96);
        Padding = new Thickness(16, 18);
        HorizontalAlignment = HorizontalAlignment.Right;
        Child = new DockPanel
        {
            Children =
            {
                new TextBlock { Text = "Queue", FontSize = 20, FontWeight = FontWeight.Bold, Margin = new Thickness(6, 0, 0, 12), [DockPanel.DockProperty] = Dock.Top },
                new ScrollViewer { Content = list },
            },
        };
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        s.Player.QueueChanged += Build;
        s.Player.PropertyChanged += OnPlayer;
        Build();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        s.Player.QueueChanged -= Build;
        s.Player.PropertyChanged -= OnPlayer;
        base.OnDetachedFromVisualTree(e);
    }

    void OnPlayer(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(Playback.Player.Track)) Build();
    }

    public void MoveUp(int upcoming) => s.Player.Move(upcoming, upcoming - 1);

    public void MoveDown(int upcoming) => s.Player.Move(upcoming, upcoming + 1);

    public void Remove(int upcoming) => s.Player.Remove(upcoming);

    void Build()
    {
        list.Children.Clear();
        var q = s.Player.Queue;
        if (q.Now is null)
        {
            list.Children.Add(Page.Note("Nothing queued. Play an album to start."));
            return;
        }
        list.Children.Add(Label("Now playing"));
        list.Children.Add(Row(q.Now, -1, q.Upcoming.Count));
        if (q.NextUp.Count > 0)
        {
            list.Children.Add(Label("Next up"));
            for (var i = 0; i < q.NextUp.Count; i++) list.Children.Add(Row(q.NextUp[i], i, q.Upcoming.Count));
        }
        if (q.Context.Count > 0)
        {
            list.Children.Add(Label(q.Source is { } src ? $"Then, from {src.Title}" : "Then"));
            for (var i = 0; i < q.Context.Count; i++) list.Children.Add(Row(q.Context[i], q.NextUp.Count + i, q.Upcoming.Count));
        }
        if (q.Upcoming.Count > 0)
        {
            var clear = new Button { Theme = Page.Bare, Content = "Clear queue", Padding = new Thickness(12, 6), CornerRadius = new CornerRadius(14), Margin = new Thickness(0, 14, 0, 0), FontWeight = FontWeight.SemiBold };
            clear.Click += (_, _) => s.Player.ClearUpcoming();
            list.Children.Add(clear);
        }
    }

    static TextBlock Label(string text) => new() { Text = text, FontSize = 12, FontWeight = FontWeight.SemiBold, Opacity = 0.6, Margin = new Thickness(6, 14, 0, 6) };

    /// A song; `upcoming` is its index in Next up then the context (−1: the one playing).
    Control Row(Track t, int upcoming, int count)
    {
        var info = new Button
        {
            Theme = Page.Bare, CornerRadius = new CornerRadius(8), Padding = new Thickness(6, 5), HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Left, IsEnabled = upcoming >= 0,
            Content = new StackPanel
            {
                Children =
                {
                    new TextBlock { Text = t.Title, FontSize = 13, FontWeight = upcoming < 0 ? FontWeight.SemiBold : FontWeight.Normal, TextTrimming = TextTrimming.CharacterEllipsis },
                    new TextBlock { Text = t.Artist, FontSize = 11, Opacity = 0.6, TextTrimming = TextTrimming.CharacterEllipsis },
                },
            },
        };
        info.Click += (_, _) => _ = s.Player.JumpTo(upcoming);
        var row = new DockPanel();
        if (upcoming >= 0)
        {
            var tools = new StackPanel { Orientation = Orientation.Horizontal, [DockPanel.DockProperty] = Dock.Right, VerticalAlignment = VerticalAlignment.Center };
            if (upcoming > 0) tools.Children.Add(Tool("↑", "Move up", () => MoveUp(upcoming)));
            if (upcoming < count - 1) tools.Children.Add(Tool("↓", "Move down", () => MoveDown(upcoming)));
            tools.Children.Add(Tool("✕", $"Remove {t.Title}", () => Remove(upcoming)));
            row.Children.Add(tools);
        }
        row.Children.Add(info);
        return row;
    }

    static Button Tool(string glyph, string name, Action click)
    {
        var b = new Button { Theme = Page.Bare, Content = glyph, Width = 28, Height = 28, CornerRadius = new CornerRadius(14), HorizontalContentAlignment = HorizontalAlignment.Center, VerticalContentAlignment = VerticalAlignment.Center };
        AutomationProperties.SetName(b, name);
        ToolTip.SetTip(b, name);
        b.Click += (_, _) => click();
        return b;
    }
}
