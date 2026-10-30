import {
  type ComponentProps,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
  useState,
} from 'react';
import { strings } from '../strings.ts';
import { Icon, type IconName } from './icons.tsx';

// Buttons, icon buttons, transport play, pills, toggles and fields (DESIGN_SYSTEM.md §9.1, §9.2,
// §9.5). States: default, hover, pressed, focus-visible, disabled, and loading where relevant.

/** Pins a pseudo-state on for the /__ui page and its snapshots; real use never sets it. */
export type Force = 'hover' | 'pressed' | 'focus';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';

/** Shared with links that look like buttons (e.g. the Stage's "Library" link). */
export const buttonClass = (variant: ButtonVariant) => `btn btn--${variant}`;

type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant;
  /** Busy: stays focusable and keeps its width, ignores activation. */
  loading?: boolean;
  /** Disabled controls always say why (§9.1); shown next to the button and announced with it. */
  disabledReason?: string;
  force?: Force;
};

export function Button({
  variant = 'secondary',
  loading = false,
  disabledReason,
  force,
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const reason = rest.disabled && disabledReason;
  return (
    <>
      <button
        type="button"
        className={`${buttonClass(variant)}${className ? ` ${className}` : ''}`}
        data-force={force}
        aria-busy={loading || undefined}
        aria-disabled={loading || undefined}
        aria-describedby={reason ? reasonId : undefined}
        onClick={loading ? (e) => e.preventDefault() : onClick}
        {...rest}
      >
        <span className="btn-label">{children}</span>
        {loading && <span className="spinner" aria-hidden="true" />}
      </button>
      {reason && (
        <span className="control-reason" id={reasonId}>
          {reason}
        </span>
      )}
    </>
  );
}

type IconButtonProps = ComponentProps<'button'> & {
  /** Accessible name; icon buttons have no visible label. */
  label: string;
  icon: IconName;
  /** md: 36px shell hit area. lg: 40px (Stage controls, prev/next). */
  size?: 'md' | 'lg';
  /** Toggle buttons (shuffle, repeat): on = accent glyph plus a dot, never colour alone (§9.2). */
  pressed?: boolean;
  force?: Force;
};

export function IconButton({
  label,
  icon,
  size = 'md',
  pressed,
  force,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn--${size}${className ? ` ${className}` : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      data-force={force}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}

/** Transport play/pause (§9.2): 56px, inverted; on the Stage the glyph takes the room colour. */
export function PlayButton({
  playing,
  stage = false,
  force,
  ...rest
}: ComponentProps<'button'> & { playing: boolean; stage?: boolean; force?: Force }) {
  return (
    <button
      type="button"
      className={`play-btn${stage ? ' play-btn--stage' : ''}`}
      aria-label={playing ? strings.ui.pause : strings.ui.play}
      data-playing={playing}
      data-force={force}
      {...rest}
    >
      <Icon name="play" className="play-btn-play" solid />
      <Icon name="pause" className="play-btn-pause" />
    </button>
  );
}

export type PillTone = 'pos' | 'warn' | 'neg' | 'neutral';

/** Status pill (§3.1 pairs): always text, the tone only reinforces it. */
export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

/** 12px provider/device mark at the dock's right (§9.2). */
export function ProviderMark({ children }: { children: ReactNode }) {
  return <span className="provider-mark">{children}</span>;
}

/** Toggle (§9.5), a `role="switch"` button labelled by its row. */
export function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
  force?: Force;
}) {
  const reasonId = useId();
  const reason = props.disabled && props.disabledReason;
  return (
    <label className="toggle-row" data-disabled={props.disabled || undefined}>
      <span className="toggle-label">{props.label}</span>
      <button
        type="button"
        role="switch"
        className="toggle"
        aria-checked={props.checked}
        aria-describedby={reason ? reasonId : undefined}
        disabled={props.disabled}
        data-force={props.force}
        onClick={() => props.onChange(!props.checked)}
      />
      {reason && (
        <span className="control-reason" id={reasonId}>
          {reason}
        </span>
      )}
    </label>
  );
}

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
  type?: 'text' | 'url' | 'email' | 'search';
  /** Masked with a Show/Hide toggle. Never prefilled from the server (§9.5). */
  secret?: boolean;
  hint?: string;
  error?: string;
  force?: Force;
};

/** Text input (§9.5): 40px, label above, error below with an icon. */
export function Field({ label, type = 'text', secret, hint, error, force, ...input }: FieldProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className="field" data-invalid={!!error || undefined}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="field-control">
        <input
          id={id}
          className="field-input"
          type={secret && !shown ? 'password' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          data-force={force}
          spellCheck={secret ? false : undefined}
          {...input}
        />
        {secret && (
          <button
            type="button"
            className="field-reveal"
            // The visible word stays inside the name (WCAG 2.5.3): "Show password".
            aria-label={`${shown ? strings.ui.hide : strings.ui.show} ${label.toLowerCase()}`}
            aria-controls={id}
            disabled={input.disabled}
            onClick={() => setShown(!shown)}
          >
            {shown ? strings.ui.hide : strings.ui.show}
          </button>
        )}
      </div>
      {hint && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`}>
          <Icon name="alert" />
          {error}
        </p>
      )}
    </div>
  );
}
