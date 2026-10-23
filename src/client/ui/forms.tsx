import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { strings } from '../strings.ts';
import { Button, Field, Pill, type PillTone } from './controls.tsx';
import { Icon } from './icons.tsx';

// Connection status row (DESIGN_SYSTEM.md §9.7, SETTINGS_AND_SECURITY.md §8) and the sign-in form
// (PRODUCT_SPEC.md S8). Visuals only: the server side arrives in M5.

/** Provider name (16/500), status pill, one line of detail, actions on the right. */
export function ConnectionRow(p: {
  name: string;
  status: { tone: PillTone; label: string };
  detail: string;
  actions: ReactNode;
}) {
  const nameId = useId();
  return (
    <section className="conn-row" aria-labelledby={nameId}>
      <div className="conn-head">
        <h3 className="conn-name" id={nameId}>
          {p.name}
        </h3>
        <Pill tone={p.status.tone}>{p.status.label}</Pill>
      </div>
      <p className="conn-detail">{p.detail}</p>
      <div className="conn-actions">{p.actions}</div>
    </section>
  );
}

export type SignInStep = 'credentials' | 'totp';

/**
 * Sign in (S8): a 360px column, the wordmark and one form; password first, then the TOTP step.
 * Errors are generic (SETTINGS_AND_SECURITY.md §4.4) and belong to the form, not a field.
 */
export function SignInForm(p: {
  step: SignInStep;
  busy?: boolean;
  error?: string;
  onSubmit: (values: { username: string; password: string; code: string }) => void;
}) {
  const [values, setValues] = useState({ username: '', password: '', code: '' });
  const titleId = useId();
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues({ ...values, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!p.busy) p.onSubmit(values);
  };
  const s = strings.signIn;
  return (
    <form className="signin" aria-labelledby={titleId} onSubmit={submit} noValidate>
      <p className="signin-mark">{strings.app}</p>
      <h2 className="signin-title" id={titleId}>
        {p.step === 'credentials' ? s.title : s.totpTitle}
      </h2>
      {p.step === 'credentials' ? (
        <>
          <Field
            label={s.username}
            autoComplete="username"
            value={values.username}
            onChange={set('username')}
            readOnly={p.busy}
          />
          <Field
            label={s.password}
            secret
            autoComplete="current-password"
            value={values.password}
            onChange={set('password')}
            readOnly={p.busy}
          />
        </>
      ) : (
        <Field
          label={s.code}
          hint={s.codeHint}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={values.code}
          onChange={set('code')}
          readOnly={p.busy}
        />
      )}
      {p.error && (
        <p className="form-error" role="alert">
          <Icon name="alert" />
          {p.error}
        </p>
      )}
      <Button variant="primary" type="submit" loading={p.busy} className="signin-submit">
        {p.step === 'credentials' ? s.submit : s.verify}
      </Button>
    </form>
  );
}
