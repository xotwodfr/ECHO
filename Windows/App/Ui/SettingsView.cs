using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Echo.Stage;

namespace Echo.Ui;

/// One of the user's sessions or devices (`/me/sessions`).
public sealed record SessionInfo(string Id, string Kind, string? Name, long CreatedAt, long LastSeenAt, string? Location, bool Current);

/// Settings (PRODUCT_SPEC.md S5), the web's sections without admin, the Navidrome connection and
/// Performance mode (they stay on the web): Visuals, Lyrics, Playback, and Account with this user's
/// sessions and devices. Changes apply at once and are kept on this computer.
public sealed class SettingsView : UserControl
{
    readonly Session s;
    readonly StackPanel column = new();
    readonly StackPanel devices = new() { Spacing = 2 };
    readonly TextBlock status = Page.Note();
    readonly TextBlock who = Page.Note();

    public SettingsView(Session session)
    {
        s = session;
        var p = s.Prefs.State;
        column.Children.Add(Page.Title("Settings"));
        column.Children.Add(status);

        column.Children.Add(Page.Heading("Visuals"));
        column.Children.Add(Choice("Stage visuals", Enum.GetValues<VisualMode>(), p.Mode, v => s.Prefs.Update(x => x with { Mode = v })));
        column.Children.Add(Choice("Reverb intensity", Enum.GetValues<Intensity>(), p.Intensity, v => s.Prefs.Update(x => x with { Intensity = v })));
        column.Children.Add(Choice("Quality", Enum.GetValues<Quality>(), p.Quality, v => s.Prefs.Update(x => x with { Quality = v })));
        column.Children.Add(Choice("Motion", Enum.GetValues<Motion>(), p.Motion, v => s.Prefs.Update(x => x with { Motion = v })));
        column.Children.Add(Slider("Cover brightness", 0, 1, p.Backdrop, v => $"{v:P0}", v => s.Prefs.Update(x => x with { Backdrop = (float)v })));

        column.Children.Add(Page.Heading("Lyrics"));
        column.Children.Add(Slider("Lyrics size", 0.75, 1.5, p.LyricScale, v => $"{v:P0}", v => s.Prefs.Update(x => x with { LyricScale = (float)v })));
        column.Children.Add(Slider("Timing offset for all tracks", -1000, 1000, p.LyricOffsetMs, Offset,
            v => s.Prefs.Update(x => x with { LyricOffsetMs = (long)(Math.Round(v / 50) * 50) }), step: 50));
        column.Children.Add(Page.Note("Positive shows words later. [ and ] adjust it by 50 ms in the Listen room."));
        column.Children.Add(Toggle("Show unsynced lyrics", p.ShowUnsynced, v => s.Prefs.Update(x => x with { ShowUnsynced = v })));

        column.Children.Add(Page.Heading("Playback"));
        column.Children.Add(Toggle("Scrobble plays to Navidrome", p.Scrobble, v => s.Prefs.Update(x => x with { Scrobble = v })));

        column.Children.Add(Page.Heading("Account"));
        column.Children.Add(who);
        column.Children.Add(Page.Heading("Sessions & devices"));
        column.Children.Add(devices);
        var others = new Button { Theme = Page.Bare, Content = "Sign out everywhere else", Padding = new Thickness(14, 7), CornerRadius = new CornerRadius(16), Margin = new Thickness(8, 8, 0, 0), BorderBrush = new SolidColorBrush(Color.Parse("#40FFFFFF")), BorderThickness = new Thickness(1) };
        others.Click += (_, _) => _ = Page.Load(s, status, async () =>
        {
            await s.Api.Send(HttpMethod.Post, "/me/sessions/revoke-others");
            await LoadDevices();
        });
        column.Children.Add(others);
        column.Children.Add(Page.Primary("Sign out", () => _ = s.Player.SignOut()));
        Content = Page.Scroll(column);
        if (!s.Fixtures) _ = Page.Load(s, status, Load);
    }

    static string Offset(double ms) => ms == 0 ? "0 ms" : $"{(ms > 0 ? "+" : "−")}{Math.Abs(ms):0} ms";

    async Task Load()
    {
        var me = await s.Api.Get("/me");
        who.Text = $"Signed in as {Api.Text(me["username"])}";
        who.IsVisible = true;
        await LoadDevices();
    }

    async Task LoadDevices()
    {
        var sessions = Json.From<List<SessionInfo>>(await s.Api.Get("/me/sessions")) ?? [];
        devices.Children.Clear();
        foreach (var d in sessions.OrderByDescending(x => x.Current).ThenByDescending(x => x.LastSeenAt))
        {
            var name = d.Name ?? (d.Kind == "web" ? "Browser" : "Device");
            var detail = d.Current ? "This device" : $"Last seen {Ago(d.LastSeenAt)}{(d.Location is { } l ? $" · {l}" : "")}";
            var row = new DockPanel { Margin = new Thickness(8, 4) };
            if (!d.Current)
            {
                var revoke = new Button { Theme = Page.Bare, Content = "Revoke", Padding = new Thickness(12, 5), CornerRadius = new CornerRadius(14), [DockPanel.DockProperty] = Dock.Right, VerticalAlignment = VerticalAlignment.Center, BorderBrush = new SolidColorBrush(Color.Parse("#33FFFFFF")), BorderThickness = new Thickness(1) };
                revoke.Click += (_, _) => _ = Page.Load(s, status, async () =>
                {
                    await s.Api.Send(HttpMethod.Delete, $"/me/sessions/{Uri.EscapeDataString(d.Id)}");
                    await LoadDevices();
                });
                row.Children.Add(revoke);
            }
            row.Children.Add(new StackPanel
            {
                Children =
                {
                    new TextBlock { Text = name, FontSize = 14, FontWeight = d.Current ? FontWeight.SemiBold : FontWeight.Normal },
                    new TextBlock { Text = detail, FontSize = 12, Opacity = 0.6 },
                },
            });
            devices.Children.Add(row);
        }
    }

    static string Ago(long ms)
    {
        var d = DateTimeOffset.UtcNow - DateTimeOffset.FromUnixTimeMilliseconds(ms);
        return d.TotalMinutes < 1 ? "just now"
            : d.TotalHours < 1 ? $"{(int)d.TotalMinutes} min ago"
            : d.TotalDays < 1 ? $"{(int)d.TotalHours} h ago"
            : d.TotalDays < 30 ? $"{(int)d.TotalDays} days ago"
            : DateTimeOffset.FromUnixTimeMilliseconds(ms).LocalDateTime.ToString("d");
    }

    static Control Row(string label, Control control) => new DockPanel
    {
        Margin = new Thickness(8, 6),
        Children =
        {
            new TextBlock { Text = label, Width = 260, FontSize = 14, VerticalAlignment = VerticalAlignment.Center, [DockPanel.DockProperty] = Dock.Left },
            control,
        },
    };

    static Control Choice<T>(string label, T[] values, T current, Action<T> set) where T : struct, Enum
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        foreach (var v in values)
        {
            var b = new Button { Theme = Page.Bare, Content = v.ToString(), Padding = new Thickness(12, 5), CornerRadius = new CornerRadius(14), FontSize = 13, Opacity = Equals(v, current) ? 1 : 0.55, Tag = v };
            b.Click += (_, _) =>
            {
                set(v);
                foreach (var x in row.Children) x.Opacity = Equals(((Button)x).Tag, v) ? 1 : 0.55;
            };
            row.Children.Add(b);
        }
        return Row(label, row);
    }

    static Control Slider(string label, double min, double max, double value, Func<double, string> show, Action<double> set, double step = 0)
    {
        var text = new TextBlock { Text = show(value), Width = 80, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 0, 0) };
        var slider = new Slider { Minimum = min, Maximum = max, Value = value, Width = 280, HorizontalAlignment = HorizontalAlignment.Left, SmallChange = step > 0 ? step : (max - min) / 20, TickFrequency = step, IsSnapToTickEnabled = step > 0 };
        slider.ValueChanged += (_, e) =>
        {
            text.Text = show(e.NewValue);
            set(e.NewValue);
        };
        return Row(label, new StackPanel { Orientation = Orientation.Horizontal, Children = { slider, text } });
    }

    static Control Toggle(string label, bool value, Action<bool> set)
    {
        var toggle = new ToggleSwitch { IsChecked = value, OnContent = "", OffContent = "" };
        toggle.IsCheckedChanged += (_, _) => set(toggle.IsChecked == true);
        return Row(label, toggle);
    }
}
