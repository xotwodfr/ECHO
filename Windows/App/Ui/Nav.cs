namespace Echo.Ui;

/// A place in the app: a page (Cider's route names: "home", "library-songs", "album", …) and what it
/// shows.
public sealed record Route(string Page, string? Id = null, string? Title = null);

/// Back and Forward, as Cider's chevrons in the top chrome.
public sealed class Nav
{
    readonly Stack<Route> back = [];
    readonly Stack<Route> forward = [];

    public Route Current { get; private set; } = new("home");
    public bool CanBack => back.Count > 0;
    public bool CanForward => forward.Count > 0;

    public event Action? Changed;

    public void Open(Route to)
    {
        if (to == Current) return;
        back.Push(Current);
        forward.Clear();
        Go(to);
    }

    public void Back()
    {
        if (!CanBack) return;
        forward.Push(Current);
        Go(back.Pop());
    }

    public void Forward()
    {
        if (!CanForward) return;
        back.Push(Current);
        Go(forward.Pop());
    }

    void Go(Route to)
    {
        Current = to;
        Changed?.Invoke();
    }
}
