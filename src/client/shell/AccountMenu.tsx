import { useStore } from 'zustand';
import { logout, sessionStore } from '../session.ts';
import { strings } from '../strings.ts';
import { Icon } from '../ui/icons.tsx';
import { Menu } from '../ui/overlays.tsx';
import { useView } from './link.tsx';

/** The account menu: Account, Settings, Admin and Sign out. */
export function AccountMenu() {
  const session = useStore(sessionStore);
  const navigate = useView((s) => s.navigate);
  const signedIn = session.status === 'signedIn';
  const admin = signedIn && session.role === 'admin';
  const initial = signedIn ? session.username.slice(0, 1).toUpperCase() : '';
  return (
    <Menu
      label={strings.nav.profile}
      trigger={{
        className: 'avatar-btn',
        content: initial ? <span className="avatar">{initial}</span> : <Icon name="user" />,
      }}
      items={[
        {
          label: strings.nav.account,
          onSelect: () => navigate({ view: 'settings', section: 'account' }),
        },
        {
          label: strings.nav.settings,
          onSelect: () => navigate({ view: 'settings', section: 'preferences' }),
        },
        ...(admin
          ? [
              {
                label: strings.nav.admin,
                onSelect: () => navigate({ view: 'settings', section: 'admin' }),
              },
            ]
          : []),
        ...(signedIn
          ? [
              {
                label: strings.nav.signOut,
                onSelect: () => void logout().finally(() => window.location.assign('/login')),
              },
            ]
          : []),
      ]}
    />
  );
}
