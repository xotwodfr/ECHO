import { type ReactNode, useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { usePlayback } from '../playback/context.tsx';
import { stageChrome, stageStatus } from '../stage/status.ts';
import type { FrameParams } from '../view.ts';

// S1 Listen's stage: React mounts the engine once and never reconciles what it draws
// (TECHNICAL_ARCHITECTURE.md §4.1). The engine and three.js load with the first visit.

export function Stage({
  children,
  frame,
  room = true,
}: {
  children: ReactNode;
  frame?: FrameParams;
  /** False: the lyric field without the room (YouTube Music mode's paper). */
  room?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = usePlayback();
  const status = useStore(stageStatus);

  const handle = useRef<{ dispose(): void; setChrome(visible: boolean): void } | null>(null);
  const chromeHidden = useStore(stageChrome, (s) => s.hidden);

  useEffect(() => {
    let cancelled = false;
    void import('../stage/engine.ts').then(({ mountStage }) => {
      if (cancelled || !root.current || !canvas.current) return;
      const h = mountStage(root.current, canvas.current, { controller, frame, room });
      h.setChrome(!stageChrome.getState().hidden);
      handle.current = h;
    });
    return () => {
      cancelled = true;
      handle.current?.dispose();
      handle.current = null;
    };
  }, [controller, frame, room]);

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
    >
      <div className="stage-room-css" aria-hidden="true" />
      <canvas ref={canvas} className="stage-canvas" />
      {children}
    </div>
  );
}
