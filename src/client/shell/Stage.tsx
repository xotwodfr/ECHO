import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { usePlayback } from '../playback/context.tsx';
import { stageChrome, stageStatus } from '../stage/status.ts';
import type { FrameParams } from '../view.ts';
import { stageGrowing, stageGrown } from './page-transition.ts';

// S1 Listen's stage: React mounts the engine once and never reconciles what it draws
// (TECHNICAL_ARCHITECTURE.md §4.1). The engine and three.js load with the first visit.

export function Stage({ children, frame }: { children: ReactNode; frame?: FrameParams }) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = usePlayback();
  const status = useStore(stageStatus);

  const handle = useRef<{ dispose(): void; setChrome(visible: boolean): void } | null>(null);
  const chromeHidden = useStore(stageChrome, (s) => s.hidden);
  // The room: until it starts the CSS room stands in (stage.css); started after the view grew in,
  // it fades in over that.
  const [room, setRoom] = useState<'on' | 'fade' | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Starting the room compiles shaders on the main thread: not while the view grows in
    // (page-transition.ts), or the growth would stall.
    const late = stageGrowing();
    void stageGrown()
      .then(() => import('../stage/engine.ts'))
      .then(({ mountStage }) => {
        if (cancelled || !root.current || !canvas.current) return;
        const h = mountStage(root.current, canvas.current, { controller, frame });
        h.setChrome(!stageChrome.getState().hidden);
        handle.current = h;
        setRoom(late ? 'fade' : 'on');
      });
    return () => {
      cancelled = true;
      handle.current?.dispose();
      handle.current = null;
    };
  }, [controller, frame]);

  // The scrims fade with the chrome (DESIGN_SYSTEM.md §7.7).
  useEffect(() => handle.current?.setChrome(!chromeHidden), [chromeHidden]);

  return (
    <div
      ref={root}
      className="stage"
      data-renderer={status.renderer}
      data-reason={status.reason ?? undefined}
      data-mode={status.mode}
      data-cover={status.cover}
      data-room={room ?? undefined}
    >
      <div className="stage-room-css" aria-hidden="true" />
      <canvas ref={canvas} className="stage-canvas" />
      {children}
    </div>
  );
}
