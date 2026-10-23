import { type ReactNode, useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { usePlayback } from '../playback/context.tsx';
import { stageStatus } from '../stage/status.ts';

// S1 Listen's stage: React mounts the engine once and never reconciles what it draws
// (TECHNICAL_ARCHITECTURE.md §4.1). The engine and three.js load with the first visit.

export function Stage({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = usePlayback();
  const status = useStore(stageStatus);

  useEffect(() => {
    let handle: { dispose(): void } | null = null;
    let cancelled = false;
    void import('../stage/engine.ts').then(({ mountStage }) => {
      if (cancelled || !root.current || !canvas.current) return;
      handle = mountStage(root.current, canvas.current, { controller });
    });
    return () => {
      cancelled = true;
      handle?.dispose();
    };
  }, [controller]);

  return (
    <div
      ref={root}
      className="stage"
      data-renderer={status.renderer}
      data-reason={status.reason ?? undefined}
      data-mode={status.mode}
    >
      <div className="stage-room-css" aria-hidden="true" />
      <canvas ref={canvas} className="stage-canvas" />
      {children}
    </div>
  );
}
