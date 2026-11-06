namespace Echo.Playback;

public enum Repeat { Off, All, One }

/// The queue as the web shows and saves it (QueueState; src/client/playback/queue.ts): what played, what
/// plays, what was added (Next up, which plays first), and the rest of where it plays from (the
/// context). Pure: the Player plays what this says.
public sealed class Queue
{
    readonly List<Track> history = [];
    readonly List<Track> nextUp = [];
    List<Track> context = [];
    List<Track> order = []; // the context's own order, for shuffle off

    public Track? Now { get; private set; }
    public PlayContext? Source { get; private set; }
    public bool Shuffle { get; private set; }
    public Repeat Repeat { get; set; }
    public IReadOnlyList<Track> History => history;
    public IReadOnlyList<Track> NextUp => nextUp;
    public IReadOnlyList<Track> Context => context;
    /// Next up, then the context: what the queue sheet lists, and what Move and Remove index.
    public IReadOnlyList<Track> Upcoming => [.. nextUp, .. context];

    /// `list` from `index`: the songs before it count as played, as the web's timeline has them.
    public void PlayList(IReadOnlyList<Track> list, int index, PlayContext ctx)
    {
        index = Math.Clamp(index, 0, list.Count - 1);
        history.Clear();
        history.AddRange(list.Take(index));
        Now = list[index];
        nextUp.Clear();
        order = list.Skip(index + 1).ToList();
        context = Shuffle ? Shuffled(order, Random.Shared) : [.. order];
        Source = ctx;
    }

    /// The song after Now, which becomes Now; null at the end (Repeat Off). A song that ends by itself
    /// repeats under Repeat One; a skip moves on.
    public Track? Advance(bool userSkip)
    {
        if (Now is null) return null;
        if (Repeat == Repeat.One && !userSkip) return Now;
        if (nextUp.Count == 0 && context.Count == 0)
        {
            if (Repeat != Repeat.All) return null;
            // From the top: everything played becomes the context again.
            var all = history.Append(Now).ToList();
            history.Clear();
            order = all;
            context = Shuffle ? Shuffled(all, Random.Shared) : [.. all];
            Now = null;
            return Take(context);
        }
        history.Add(Now);
        return nextUp.Count > 0 ? Take(nextUp) : Take(context);
    }

    Track Take(List<Track> from)
    {
        Now = from[0];
        from.RemoveAt(0);
        return Now;
    }

    /// The song before Now; Now goes back to the front of the context. Null when nothing played before.
    public Track? Back()
    {
        if (history.Count == 0 || Now is null) return null;
        context.Insert(0, Now);
        Now = history[^1];
        history.RemoveAt(history.Count - 1);
        return Now;
    }

    public void PlayNext(Track t) => nextUp.Insert(0, t);

    public void AddToQueue(Track t) => nextUp.Add(t);

    /// Moves within Upcoming; Next up keeps its size, so a song can move across the line.
    public void Move(int from, int to)
    {
        var all = Upcoming.ToList();
        if (from < 0 || from >= all.Count || to < 0 || to >= all.Count) return;
        var t = all[from];
        all.RemoveAt(from);
        all.Insert(to, t);
        var n = nextUp.Count;
        nextUp.Clear();
        nextUp.AddRange(all.Take(n));
        context = all.Skip(n).ToList();
    }

    public void Remove(int index)
    {
        if (index < 0) return;
        if (index < nextUp.Count) nextUp.RemoveAt(index);
        else if (index - nextUp.Count < context.Count) context.RemoveAt(index - nextUp.Count);
    }

    /// Clear queue: everything after Now goes; Now keeps playing.
    public void Clear()
    {
        nextUp.Clear();
        context.Clear();
        order.Clear();
    }

    /// Shuffle reorders the context only; off puts what is left back in its own order.
    public void SetShuffle(bool on, Random rng)
    {
        if (on == Shuffle) return;
        Shuffle = on;
        if (on) context = Shuffled(context, rng);
        else
        {
            var left = context.ToHashSet();
            context = order.Where(left.Contains).Concat(context.Where(t => !order.Contains(t))).ToList();
        }
    }

    static List<Track> Shuffled(IEnumerable<Track> list, Random rng)
    {
        var a = list.ToList();
        for (var i = a.Count - 1; i > 0; i--)
        {
            var j = rng.Next(i + 1);
            (a[i], a[j]) = (a[j], a[i]);
        }
        return a;
    }

    /// Signed out: nothing of it stays (REL-05).
    public void Reset()
    {
        history.Clear();
        Clear();
        Now = null;
        Source = null;
    }

    /// What `/me/queue` keeps: the last 20 played, as the web saves it.
    public QueueState ToState() => new("navidrome", Now, nextUp.ToList(), context.ToList(), Source, history.TakeLast(20).ToList());

    public static Queue FromState(QueueState s)
    {
        var q = new Queue { Now = s.Now, Source = s.ContextSource };
        q.history.AddRange(s.History);
        q.nextUp.AddRange(s.NextUp);
        q.context = [.. s.Context];
        q.order = [.. s.Context];
        return q;
    }
}
