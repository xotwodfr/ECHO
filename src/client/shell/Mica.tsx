import { useEffect, useRef } from 'react';
import { startMica } from '../palette/mica.ts';

// The album's glow behind the frame (DESIGN_SYSTEM.md §6): fixed, so it takes no grid cell.
export function Mica() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => (host.current ? startMica(host.current) : undefined), []);
  return (
    <div className="mica" aria-hidden="true" ref={host}>
      <div className="mica-layer" />
      <div className="mica-layer" />
    </div>
  );
}
