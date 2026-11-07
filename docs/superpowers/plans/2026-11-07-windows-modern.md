# Windows: modern design pass

Owner, 2026-11-07 20:49 UTC: "do a deepdive and improve everything with modern design". Earlier rulings
still hold: Cider's layout ("restyle it as cider, but better"), no live blur, the owner delegates design
calls. Deep dive = every screen saved with `ECHO_SHOTS` and read against the code.

What looked dated or broken, and the fix:

1. **Shell.** The page sits flush against the sidebar like 2021 Electron. → The page becomes a floating
   card (radius 10, hairline edge, 8 px gutter) on the window's ground; the sidebar, top bar and player
   lie on the ground. Denser sidebar rows. One type scale: large titles 30 px with tight tracking,
   section titles 20 px.
2. **Player bar.** Cider 1's progress-over-controls with big timers, the "…" adrift between song and
   controls, a blue-grey volume knob. → Today's bar: 56 px artwork, song over artist, "…" beside them;
   the controls centred over a thin progress bar with small times at its ends; white volume; the bar
   lights in the key colour only under the pointer.
3. **Controls.** Context menus and flyouts in Fluent's defaults. → Cider's dark rounded menus; solid
   key-colour primary buttons, radius 8.
4. **Home and shelves.** Top Picks captions are hard-edged muddy blocks; song columns (Search, Artist,
   Favorites) scroll sideways with a stray scrollbar line across the page. → Captions melt out of the
   cover; song columns page with the shelf arrows like every other shelf.
5. **Library.** Songs has no column header (playlists do); the Artists detail pane is mostly empty. →
   Header row; the detail pane gets the artist large, Play, and the albums as a grid.
6. **Album / playlist.** "…" floats far right by the search. → "…" beside Play and Shuffle, as Apple's.
7. **Settings.** Opens over the app without dimming it; Cider 1's grey header bars. → A scrim, and
   Windows 11 setting cards with the section name above.
8. **Empty and error states.** A grey line of text at the top left. → Centred icon, title and note.

Skipped: loading skeletons (the server answers in ~150 ms), light theme (the app is dark-only).
