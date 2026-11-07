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
   Header row; the detail pane gets the artist large with Go to Artist, and the albums as a grid.
6. **Album / playlist.** "…" floats far right by the search. → "…" beside Play and Shuffle, as Apple's.
7. **Settings.** Opens over the app without dimming it; Cider 1's grey header bars. → A scrim, and
   Windows 11 setting cards with the section name above.
8. **Empty and error states.** A grey line of text at the top left. → Centred icon, title and note.

Skipped: loading skeletons (the server answers in ~150 ms), light theme (the app is dark-only).

Done 2026-11-07 (70f5bb3..d787d0d, 88 tests pass, both TFMs build); not pushed or released yet.

## Second pass (owner: "looks good, but do another deepdive", 21:16 UTC)

Screens the tests never saved, shot by hand: sign-in, mini player, main menu, the cover popover, hover
states, keyboard focus, 1920×1080.

- **Bug: the sign-in screen could not be moved or closed** (frameless window; only the shell's top bar
  had the caption buttons). Now it has them, and the form is a card. 135b7e1
- Top bar: the lone Home pill → a round Home beside a 360 px search pill, centred. e34e034
- Album pages: header faded into the songs (no shadow, no darker band); Play the one solid button in
  the album's colour; tile hover circles in the key colour; the cover popover's buttons fit. e34e034
- Keys: Space play/pause (not in a field), Ctrl+F search; focus ring rounded (Fluent's square adorner
  drew clipped to a corner over these themes, so the ring is a BoxShadow on each theme's Box). 3943bfc

Left as is: album rows stretch at 1920 px wide (as Apple Music's do).

