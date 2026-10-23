// UI copy, English (TECHNICAL_ARCHITECTURE.md §9).
export const strings = {
  app: 'ECHO',
  nav: {
    label: 'Main',
    listen: 'Listen',
    library: 'Library',
    search: 'Search',
    settings: 'Settings',
  },
  library: {
    tabs: { albums: 'Albums', artists: 'Artists', playlists: 'Playlists', starred: 'Starred' },
    tabsLabel: 'Library sections',
    empty: 'Nothing in your library yet. Connect a server in Settings.',
  },
  album: { title: 'Album', missing: 'This album is not in your library.' },
  search: {
    placeholder: 'Search',
    prompt: 'Type to search your library.',
    none: (q: string) => `No results for “${q}”.`,
  },
  settings: {
    sections: { preferences: 'Preferences', account: 'Account' },
    sectionsLabel: 'Settings sections',
    empty: 'Nothing to set here yet.',
  },
  notFound: { title: 'Page not found', body: 'There is nothing at this address.' },
  dock: { label: 'Player', idle: 'Nothing playing' },
} as const;
