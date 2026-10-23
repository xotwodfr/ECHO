import { type ReactNode, useState } from 'react';
import { strings } from '../strings.ts';
import {
  Button,
  type ButtonVariant,
  Field,
  type Force,
  IconButton,
  Pill,
  PlayButton,
  ProviderMark,
  Toggle,
} from '../ui/controls.tsx';
import { ConnectionRow, SignInForm } from '../ui/forms.tsx';
import { toastStore } from '../ui/logic.ts';
import {
  AlbumGrid,
  AlbumTile,
  AlbumTileSkeleton,
  Artwork,
  TrackList,
  TrackRow,
  TrackRowSkeleton,
} from '../ui/media.tsx';
import { ConfirmDialog, Menu, Sheet } from '../ui/overlays.tsx';
import { Scrubber, Volume } from '../ui/slider.tsx';
import cover from './gallery-cover.svg';
import coverWide from './gallery-cover-wide.svg';

// /__ui (DS-06): every DESIGN_SYSTEM.md §9 component in every state. Hover, pressed and focus are
// pinned with `force` so the page can be read and snapshotted without a pointer. Demo copy is
// fixture data, so it stays here rather than in strings.ts.

const STATES: { name: string; force?: Force }[] = [
  { name: 'Default' },
  { name: 'Hover', force: 'hover' },
  { name: 'Pressed', force: 'pressed' },
  { name: 'Focus', force: 'focus' },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="ui-section" aria-labelledby={`ui-${id}`} data-section={id}>
      <h2 id={`ui-${id}`}>{title}</h2>
      {children}
    </section>
  );
}

function Cell({
  caption,
  children,
  wide,
}: {
  caption: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <figure className="ui-cell" data-wide={wide || undefined}>
      <div className="ui-cell-body">{children}</div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

const noop = () => {};
const say = (message: string) => () => toastStore.getState().show(message);

const BUTTONS: [ButtonVariant, string][] = [
  ['primary', 'Play'],
  ['secondary', 'Shuffle'],
  ['tertiary', 'View all'],
  ['destructive', 'Disconnect'],
];

const MENU = [
  { label: 'Play next', onSelect: say('Playing next') },
  { label: 'Add to queue', onSelect: say('Added to queue') },
  { label: 'Go to album', onSelect: noop, disabled: true },
  { label: 'Remove from queue', onSelect: say('Removed from queue'), destructive: true },
];

export default function Gallery() {
  const [playing, setPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off');
  const [position, setPosition] = useState(102_000);
  const [volume, setVolume] = useState(0.6);
  const [toggle, setToggle] = useState(true);
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [signIn, setSignIn] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const nextRepeat = { off: 'all', all: 'one', one: 'off' } as const;

  return (
    <div className="ui-page">
      <h1 tabIndex={-1}>{strings.gallery.title}</h1>

      <Section id="buttons" title="Buttons">
        {BUTTONS.map(([variant, label]) => (
          <div className="ui-row" key={variant}>
            {STATES.map((s) => (
              <Cell key={s.name} caption={`${variant} · ${s.name}`}>
                <Button variant={variant} force={s.force}>
                  {label}
                </Button>
              </Cell>
            ))}
            <Cell caption={`${variant} · Disabled`}>
              <Button variant={variant} disabled disabledReason="Connect a server first">
                {label}
              </Button>
            </Cell>
            <Cell caption={`${variant} · Loading`}>
              <Button variant={variant} loading>
                {label}
              </Button>
            </Cell>
          </div>
        ))}
      </Section>

      <Section id="icon-buttons" title="Icon buttons">
        <div className="ui-row">
          {STATES.map((s) => (
            <Cell key={s.name} caption={`36 · ${s.name}`}>
              <IconButton label="Queue" icon="queue" force={s.force} />
            </Cell>
          ))}
          <Cell caption="36 · Disabled">
            <IconButton label="Queue" icon="queue" disabled />
          </Cell>
          <Cell caption="40 (Stage) · Default">
            <IconButton label="Settings" icon="settings" size="lg" />
          </Cell>
          <Cell caption="Menu trigger">
            <Menu label="More for Night Turns Over" items={MENU} />
          </Cell>
        </div>
      </Section>

      <Section id="transport" title="Transport">
        <div className="ui-row">
          <Cell caption="Play · Paused">
            <PlayButton playing={false} />
          </Cell>
          <Cell caption="Play · Playing">
            <PlayButton playing />
          </Cell>
          <Cell caption="Play · Hover">
            <PlayButton playing={false} force="hover" />
          </Cell>
          <Cell caption="Play · Focus">
            <PlayButton playing={false} force="focus" />
          </Cell>
          <Cell caption="Play · Stage glyph">
            <PlayButton playing={false} stage />
          </Cell>
          <Cell caption="Play · Disabled">
            <PlayButton playing={false} disabled />
          </Cell>
        </div>
        <div className="ui-row">
          <Cell caption="Interactive" wide>
            <div className="ui-transport">
              <IconButton
                label="Shuffle"
                icon="shuffle"
                pressed={shuffle}
                onClick={() => setShuffle(!shuffle)}
              />
              <IconButton label="Previous" icon="previous" size="lg" />
              <PlayButton playing={playing} onClick={() => setPlaying(!playing)} />
              <IconButton label="Next" icon="next" size="lg" />
              <IconButton
                label={`Repeat ${repeat}`}
                icon={repeat === 'one' ? 'repeatOne' : 'repeat'}
                pressed={repeat !== 'off'}
                onClick={() => setRepeat(nextRepeat[repeat])}
              />
            </div>
          </Cell>
          <Cell caption="Shuffle · On">
            <IconButton label="Shuffle" icon="shuffle" pressed />
          </Cell>
          <Cell caption="Repeat · One">
            <IconButton label="Repeat one" icon="repeatOne" pressed />
          </Cell>
          <Cell caption="Provider mark">
            <ProviderMark>Navidrome</ProviderMark>
          </Cell>
        </div>
      </Section>

      <Section id="sliders" title="Scrubber and volume">
        <div className="ui-stack">
          <Cell caption="Scrubber · Interactive (buffered to 2:30)" wide>
            <Scrubber
              positionMs={position}
              durationMs={245_000}
              bufferedMs={150_000}
              onSeek={setPosition}
            />
          </Cell>
          <Cell caption="Scrubber · Hover" wide>
            <Scrubber positionMs={102_000} durationMs={245_000} onSeek={noop} force="hover" />
          </Cell>
          <Cell caption="Scrubber · Focus" wide>
            <Scrubber positionMs={102_000} durationMs={245_000} onSeek={noop} force="focus" />
          </Cell>
          <Cell caption="Scrubber · Dragging (time bubble)" wide>
            <Scrubber positionMs={102_000} durationMs={245_000} onSeek={noop} force="drag" />
          </Cell>
          <Cell caption="Scrubber · Disabled" wide>
            <Scrubber
              positionMs={102_000}
              durationMs={245_000}
              onSeek={noop}
              disabled
              disabledReason="This server can't seek in converted audio."
            />
          </Cell>
          <Cell caption="Scrubber · No track" wide>
            <Scrubber
              positionMs={0}
              durationMs={undefined}
              onSeek={noop}
              disabled
              disabledReason="Nothing playing"
            />
          </Cell>
        </div>
        <div className="ui-row">
          <Cell caption="Volume · Interactive">
            <Volume value={volume} onChange={setVolume} />
          </Cell>
          <Cell caption="Volume · Muted">
            <Volume value={0} onChange={noop} />
          </Cell>
          <Cell caption="Volume · Focus">
            <Volume value={0.6} onChange={noop} force="focus" />
          </Cell>
        </div>
      </Section>

      <Section id="fields" title="Fields, toggles and pills">
        <div className="ui-row">
          <Cell caption="Field · Empty">
            <Field label="Server URL" placeholder="https://music.home.lan" />
          </Cell>
          <Cell caption="Field · Filled, hint">
            <Field
              label="Server URL"
              defaultValue="http://navidrome:4533"
              hint="The address ECHO's server uses."
            />
          </Cell>
          <Cell caption="Field · Focus">
            <Field label="Username" defaultValue="folkes" force="focus" />
          </Cell>
          <Cell caption="Field · Error">
            <Field label="Server URL" defaultValue="ftp://music" error="Use an https:// address." />
          </Cell>
          <Cell caption="Field · Disabled">
            <Field label="Username" defaultValue="folkes" disabled />
          </Cell>
          <Cell caption="Field · Secret">
            <Field label="Password" secret defaultValue="correct horse" />
          </Cell>
        </div>
        <div className="ui-row">
          <Cell caption="Toggle · Interactive">
            <Toggle label="Film grain" checked={toggle} onChange={setToggle} />
          </Cell>
          <Cell caption="Toggle · Off">
            <Toggle label="Announcements" checked={false} onChange={noop} />
          </Cell>
          <Cell caption="Toggle · Hover">
            <Toggle label="Announcements" checked={false} onChange={noop} force="hover" />
          </Cell>
          <Cell caption="Toggle · Focus">
            <Toggle label="Announcements" checked onChange={noop} force="focus" />
          </Cell>
          <Cell caption="Toggle · Disabled">
            <Toggle
              label="Crossfade"
              checked={false}
              onChange={noop}
              disabled
              disabledReason="Navidrome only"
            />
          </Cell>
        </div>
        <div className="ui-row">
          <Cell caption="Pills">
            <div className="ui-inline">
              <Pill tone="pos">Connected</Pill>
              <Pill tone="warn">Reconnecting</Pill>
              <Pill tone="neg">Credentials rejected</Pill>
              <Pill tone="neutral">Not connected</Pill>
            </div>
          </Cell>
        </div>
      </Section>

      <Section id="tracks" title="Track rows">
        <div className="ui-stack">
          <Cell
            caption="Detail table: default, hover, selected, focus, now playing, decay trace"
            wide
          >
            <TrackList label="Tide Lines" ruled>
              <TrackRow
                number={1}
                title="Into the Dark"
                artist="Pale Wave"
                durationMs={213_000}
                onPlay={noop}
                menu={MENU}
              />
              <TrackRow
                number={2}
                title="Static Hours"
                artist="Pale Wave"
                durationMs={187_000}
                onPlay={noop}
                force="hover"
                menu={MENU}
              />
              <TrackRow
                number={3}
                title="Every Sound Comes Back"
                artist="Pale Wave"
                durationMs={254_000}
                onPlay={noop}
                selected
                menu={MENU}
              />
              <TrackRow
                number={4}
                title="Undertow"
                artist="Pale Wave"
                durationMs={198_000}
                onPlay={noop}
                force="focus"
                menu={MENU}
              />
              <TrackRow
                number={5}
                title="Night Turns Over"
                artist="Pale Wave"
                durationMs={245_000}
                onPlay={noop}
                nowPlaying
                menu={MENU}
              />
              <TrackRow
                number={6}
                title="Reverb Tail"
                artist="Pale Wave"
                durationMs={301_000}
                onPlay={noop}
                decay={{ durationMs: 301_000, elapsedMs: 60_000 }}
                menu={MENU}
              />
            </TrackList>
          </Cell>
          <Cell caption="Media rows: cover, missing cover, loading" wide>
            <TrackList label="Search results">
              <TrackRow
                title="Night Turns Over"
                artist="Pale Wave"
                durationMs={245_000}
                artwork={{ src: cover, album: 'Tide Lines' }}
                onPlay={noop}
              />
              <TrackRow
                title="A Very Long Title That Has To Truncate Before It Reaches The Duration Column"
                artist="An Artist With A Long Name, Featuring Another One"
                durationMs={3_725_000}
                artwork={{ album: 'Field Recordings' }}
                onPlay={noop}
              />
              <TrackRowSkeleton media />
            </TrackList>
          </Cell>
          <Cell caption="Empty" wide>
            <TrackList label="Starred tracks">{null}</TrackList>
            <p className="empty">No starred tracks yet.</p>
          </Cell>
        </div>
      </Section>

      <Section id="tiles" title="Album tiles">
        <AlbumGrid>
          <AlbumTile
            id="al-1"
            title="Tide Lines"
            artist="Pale Wave"
            cover={cover}
            onPlay={say('Playing Tide Lines')}
          />
          <AlbumTile
            id="al-2"
            title="Wide Sleeve"
            artist="Letterbox"
            cover={coverWide}
            onPlay={noop}
            force="hover"
          />
          <AlbumTile
            id="al-3"
            title="Field Recordings, Volume Two"
            artist="No Cover"
            onPlay={noop}
            force="focus"
          />
          <AlbumTile
            id="al-4"
            title="Broken Link"
            artist="Missing File"
            cover="/__ui/missing-cover.png"
            onPlay={noop}
          />
          <AlbumTileSkeleton />
        </AlbumGrid>
        <div className="ui-row">
          <Cell caption="Artwork · row and dock sizes, small radius">
            <div className="ui-inline">
              <Artwork size="row" src={cover} title="Tide Lines" />
              <Artwork size="dock" src={cover} title="Tide Lines" />
            </div>
          </Cell>
        </div>
      </Section>

      <Section id="overlays" title="Sheet, menu, dialog and toast">
        <div className="ui-row">
          <Cell caption="Sheet">
            <Button onClick={() => setSheet(true)}>Open queue</Button>
          </Cell>
          <Cell caption="Dialog">
            <Button variant="destructive" onClick={() => setDialog(true)}>
              Disconnect
            </Button>
          </Cell>
          <Cell caption="Toast">
            <Button onClick={say('Lyrics −100 ms')}>Show toast</Button>
          </Cell>
          <Cell caption="Menu">
            <Menu label="More for Undertow" items={MENU} />
          </Cell>
        </div>
        <Sheet open={sheet} onClose={() => setSheet(false)} title="Queue">
          <h3 className="sheet-section">Now playing</h3>
          <TrackList label="Now playing">
            <TrackRow
              title="Night Turns Over"
              artist="Pale Wave"
              durationMs={245_000}
              artwork={{ src: cover, album: 'Tide Lines' }}
              onPlay={noop}
              nowPlaying
            />
          </TrackList>
          <h3 className="sheet-section">Next up</h3>
          <TrackList label="Next up">
            <TrackRow
              title="Reverb Tail"
              artist="Pale Wave"
              durationMs={301_000}
              artwork={{ src: cover, album: 'Tide Lines' }}
              onPlay={noop}
              menu={MENU}
            />
          </TrackList>
        </Sheet>
        <ConfirmDialog
          open={dialog}
          title="Disconnect Navidrome (music.home.lan)?"
          consequence="ECHO forgets your Navidrome password. Your music and playlists on the server are not changed."
          confirmLabel="Disconnect"
          onConfirm={() => {
            setDialog(false);
            toastStore.getState().show('Navidrome disconnected');
          }}
          onCancel={() => setDialog(false)}
        />
      </Section>

      <Section id="connections" title="Connection status rows">
        <div className="ui-stack">
          <ConnectionRow
            name="Navidrome"
            status={{ tone: 'pos', label: 'Connected' }}
            detail="navidrome:4533 · Navidrome 0.64.2 · 41,203 tracks · synced lyrics"
            actions={
              <>
                <Button>Test</Button>
                <Button variant="destructive">Disconnect</Button>
              </>
            }
          />
          <ConnectionRow
            name="Navidrome"
            status={{ tone: 'warn', label: 'Reconnecting' }}
            detail="navidrome:4533 · last reached 2 minutes ago"
            actions={<Button loading>Test</Button>}
          />
          <ConnectionRow
            name="Spotify"
            status={{ tone: 'neg', label: 'Sign-in expired' }}
            detail="Premium · device “ECHO” · seat 2 of 5"
            actions={<Button variant="primary">Reconnect</Button>}
          />
          <ConnectionRow
            name="Spotify"
            status={{ tone: 'neutral', label: 'Not connected' }}
            detail="Plays Spotify in this browser. Needs Premium."
            actions={
              <Button disabled disabledReason="Ask the admin to add a Spotify app">
                Connect
              </Button>
            }
          />
        </div>
      </Section>

      <Section id="signin" title="Sign in">
        <div className="ui-row">
          <Cell caption="Credentials · Interactive (any input fails)">
            <SignInForm
              step="credentials"
              busy={signIn.busy}
              error={signIn.error}
              onSubmit={() => {
                setSignIn({ busy: true });
                setTimeout(() => setSignIn({ busy: false, error: strings.signIn.failed }), 600);
              }}
            />
          </Cell>
          <Cell caption="Credentials · Submitting">
            <SignInForm step="credentials" busy onSubmit={noop} />
          </Cell>
          <Cell caption="Credentials · Error">
            <SignInForm step="credentials" error={strings.signIn.failed} onSubmit={noop} />
          </Cell>
          <Cell caption="Two-factor step">
            <SignInForm step="totp" onSubmit={noop} />
          </Cell>
        </div>
      </Section>
    </div>
  );
}
