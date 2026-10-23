import { type CSSProperties, type PointerEvent, useEffect, useId, useRef, useState } from 'react';
import { strings } from '../strings.ts';
import { IconButton } from './controls.tsx';
import { clamp, formatTime, scrubberText, sliderKey, valueAt } from './logic.ts';

// Slider (DESIGN_SYSTEM.md §9.2): `role="slider"` with keyboard, pointer and (volume) wheel input.
// The scrubber seeks on release; the volume slider changes live.

type SliderProps = {
  label: string;
  value: number;
  min?: number;
  max: number;
  step: number;
  bigStep: number;
  valueText: (v: number) => string;
  /** Live value while dragging. */
  onInput?: (v: number) => void;
  /** Committed value: key press, click, or the end of a drag. */
  onChange: (v: number) => void;
  /** A drag ended without a value (pointer cancelled). */
  onCancel?: () => void;
  variant: 'scrubber' | 'volume';
  /** Buffered end (scrubber), same unit as the value. */
  buffered?: number;
  /** Shown above the pointer while dragging (scrubber time bubble). */
  bubble?: (v: number) => string;
  /** The wheel moves the value by one step (volume). */
  wheel?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  force?: 'hover' | 'focus' | 'drag';
};

export function Slider({
  label,
  value,
  min = 0,
  max,
  step,
  bigStep,
  valueText,
  onInput,
  onChange,
  onCancel,
  variant,
  buffered,
  bubble,
  wheel,
  disabled,
  disabledReason,
  force,
}: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reasonId = useId();
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const span = max - min || 1;
  const frac = (v: number) => clamp((v - min) / span, 0, 1);

  // Wheel needs a non-passive listener to keep the page from scrolling.
  const latest = useRef({ value, onChange, disabled, step, min, max });
  latest.current = { value, onChange, disabled, step, min, max };
  useEffect(() => {
    const el = ref.current;
    if (!wheel || !el) return;
    const onWheel = (e: WheelEvent) => {
      const s = latest.current;
      if (s.disabled || e.deltaY === 0) return;
      e.preventDefault();
      s.onChange(clamp(s.value + (e.deltaY < 0 ? s.step : -s.step), s.min, s.max));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wheel]);

  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return valueAt(e.clientX, r.left, r.width, min, max);
  };

  return (
    <div
      ref={ref}
      className={`slider slider--${variant}`}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(shown.toFixed(2))}
      aria-valuetext={valueText(shown)}
      aria-disabled={disabled || undefined}
      aria-describedby={disabled && disabledReason ? reasonId : undefined}
      title={disabled ? disabledReason : undefined}
      data-dragging={drag !== null || force === 'drag' || undefined}
      data-force={force}
      style={
        {
          '--value': frac(shown),
          '--buffered': buffered === undefined ? 0 : frac(buffered),
        } as CSSProperties
      }
      onKeyDown={(e) => {
        if (disabled) return;
        const next = sliderKey(value, e.key, e.shiftKey, { min, max, step, bigStep });
        if (next === null) return;
        e.preventDefault();
        onInput?.(next);
        onChange(next);
      }}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
        const v = at(e);
        setDrag(v); // pointer-down jumps to the point
        onInput?.(v);
      }}
      onPointerMove={(e) => {
        if (drag === null) return;
        const v = at(e);
        setDrag(v);
        onInput?.(v);
      }}
      onPointerUp={() => {
        if (drag === null) return;
        setDrag(null);
        onChange(drag);
      }}
      onPointerCancel={() => {
        setDrag(null);
        onCancel?.();
      }}
    >
      <span className="slider-rail">
        {buffered !== undefined && <span className="slider-buffered" />}
        <span className="slider-fill" />
      </span>
      <span className="slider-thumb" />
      {bubble && (drag !== null || force === 'drag') && (
        <span className="slider-bubble num" aria-hidden="true">
          {bubble(shown)}
        </span>
      )}
      {disabled && disabledReason && (
        <span className="visually-hidden" id={reasonId}>
          {disabledReason}
        </span>
      )}
    </div>
  );
}

const SEEK_STEP_MS = 5000; // ←/→ (§9.2)
const SEEK_BIG_STEP_MS = 15000; // Shift+←/→

/**
 * The dock's scrubber (§9.2): elapsed and total time either side, seek on release. No duration
 * means no track: both times are a grey dash, not `0:00` (a real zero-length track).
 */
export function Scrubber(props: {
  positionMs: number;
  durationMs: number | undefined;
  bufferedMs?: number;
  onSeek: (ms: number) => void;
  /** The time being dragged to, null when the drag ends (the lyric field's scrub mode). */
  onScrub?: (ms: number | null) => void;
  disabled?: boolean;
  disabledReason?: string;
  force?: 'hover' | 'focus' | 'drag';
}) {
  const [live, setLiveState] = useState<number | null>(null);
  const setLive = (ms: number | null) => {
    setLiveState(ms);
    props.onScrub?.(ms);
  };
  const empty = props.durationMs === undefined;
  const time = (ms: number) => (
    <span
      className="scrubber-time num"
      data-empty={empty || undefined}
      aria-hidden={empty || undefined}
    >
      {empty ? <span className="scrubber-dash">—</span> : formatTime(ms)}
    </span>
  );
  return (
    <div className="scrubber">
      {time(live ?? props.positionMs)}
      <Slider
        variant="scrubber"
        label={strings.ui.seek}
        value={props.positionMs}
        max={props.durationMs ?? 0}
        step={SEEK_STEP_MS}
        bigStep={SEEK_BIG_STEP_MS}
        buffered={props.bufferedMs}
        valueText={(v) => (empty ? strings.ui.noTrack : scrubberText(v, props.durationMs ?? 0))}
        bubble={formatTime}
        onInput={setLive}
        onChange={(v) => {
          props.onSeek(v);
          setLive(null);
        }}
        onCancel={() => setLive(null)}
        disabled={props.disabled}
        disabledReason={props.disabledReason}
        force={props.force}
      />
      {time(props.durationMs ?? 0)}
    </div>
  );
}

/** Volume (§9.2): 96px, 5% steps (wheel too); mute returns to the previous value. */
export function Volume({
  value,
  onChange,
  force,
}: {
  value: number;
  onChange: (v: number) => void;
  force?: 'hover' | 'focus' | 'drag';
}) {
  const previous = useRef(value > 0 ? value : 1);
  if (value > 0) previous.current = value;
  const muted = value === 0;
  return (
    <div className="volume">
      <IconButton
        className="icon-btn--plain"
        label={strings.ui.mute}
        icon={muted ? 'muted' : 'volume'}
        pressed={muted}
        onClick={() => onChange(muted ? previous.current : 0)}
      />
      <Slider
        variant="volume"
        label={strings.ui.volume}
        value={value}
        max={1}
        step={0.05}
        bigStep={0.2}
        wheel
        valueText={(v) => `${Math.round(v * 100)}%`}
        onInput={onChange}
        onChange={onChange}
        force={force}
      />
    </div>
  );
}
