import type { Route } from '../view.ts';
import { ModeSwitch } from './ModeSwitch.tsx';

/** YouTube Music mode's frame (Task 8 fills it in). */
export function YtFrame(_: { route: Extract<Route, { view: 'yt' }> }) {
  return (
    <div className="yt">
      <ModeSwitch />
      <h1>YouTube Music</h1>
    </div>
  );
}
