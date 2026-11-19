import { useEffect, useId, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { api } from '../api.ts';
import { THEMES, themeOf } from '../appearance.ts';
import { MAX_CROSSFADE_S } from '../playback/crossfade.ts';
import { EQ_BANDS, EQ_MAX_DB, EQ_PRESET_IDS, eqGains } from '../playback/eq.ts';
import { type Prefs, prefsStore, setPref } from '../prefs.ts';
import { webgl2Supported } from '../stage/status.ts';
import { strings } from '../strings.ts';
import { Pill, Toggle } from '../ui/controls.tsx';
import { toastStore } from '../ui/logic.ts';
import { useSlide } from '../ui/motion.ts';
import { Slider } from '../ui/slider.tsx';

// Settings → Preferences (SETTINGS_AND_SECURITY.md §7.1, §7.3): Playback, Lyrics, Visuals,
// Keyboard and About. Every control saves itself (taste-skill app rules §8.2): no Save button. The
// two per-device keys say so; features that are not built yet are shown disabled with the reason.

const t = strings.prefs;

/** A short list of choices as a segmented control (the album sort's `view-switch`). */
function Choice<T extends string | number>(p: {
  label: string;
  value: T;
  options: readonly T[];
  names: (v: T) => string;
  hint?: string;
  /** Decided elsewhere (Performance mode): the saved choice shows, and cannot be changed. */
  disabled?: boolean;
  onChange: (v: T) => void;
}) {
  const hintId = useId();
  const choices = useRef<HTMLDivElement>(null);
  useSlide(choices, '[aria-pressed="true"]', p.value);
  return (
    <fieldset
      className="pref-choice"
      disabled={p.disabled}
      aria-describedby={p.hint ? hintId : undefined}
    >
      <legend className="pref-label">{p.label}</legend>
      <div className="view-switch" ref={choices}>
        {p.options.map((o) => (
          <button
            key={String(o)}
            type="button"
            aria-pressed={o === p.value}
            onClick={() => p.onChange(o)}
          >
            {p.names(o)}
          </button>
        ))}
      </div>
      {p.hint && (
        <p className="field-hint" id={hintId}>
          {p.hint}
        </p>
      )}
    </fieldset>
  );
}

/** Saves one preference, telling the user when the server refused. */
function save<S extends keyof Prefs, K extends keyof Prefs[S]>(s: S, k: K, v: Prefs[S][K]) {
  setPref(s, k, v).catch(() => toastStore.getState().show(t.notSaved));
}

/** Settings → Appearance: the themes as swatches (Android's ThemePicker), each drawn in its own
 * ground, face, corners and accent by tokens.css (`.theme-swatch[data-theme]`). */
function ThemePicker(p: { value: string; onChange: (id: (typeof THEMES)[number]['id']) => void }) {
  const hintId = useId();
  const current = themeOf(p.value).id;
  const systemDark = matchMedia('(prefers-color-scheme: dark)').matches;
  return (
    <fieldset className="pref-choice" aria-describedby={hintId}>
      <legend className="pref-label">{t.theme}</legend>
      <div className="theme-picker">
        {THEMES.map((th) => (
          <button
            key={th.id}
            type="button"
            className="theme-pick"
            aria-pressed={th.id === current}
            title={th.blurb}
            onClick={() => p.onChange(th.id)}
          >
            <span
              className="theme-swatch"
              data-theme={th.id}
              data-scheme={(th.dark ?? systemDark) ? 'dark' : 'light'}
              data-material={th.material}
              aria-hidden="true"
            >
              <span className="theme-swatch-aa">Aa</span>
              <span className="theme-swatch-art">
                <span />
                <span />
              </span>
              <span className="theme-swatch-button" />
            </span>
            <span className="theme-pick-name">{th.label}</span>
          </button>
        ))}
      </div>
      <p className="field-hint" id={hintId}>
        {t.themeHint}
      </p>
    </fieldset>
  );
}

export function PreferencesSection() {
  const p = useStore(prefsStore);
  const perf = p.visuals.performance; // it decides the room and the motion while it is on
  return (
    <div className="prefs">
      <section className="pref-group" aria-labelledby="pref-appearance">
        <h3 id="pref-appearance">{t.appearance}</h3>
        <ThemePicker value={p.appearance.theme} onChange={(v) => save('appearance', 'theme', v)} />
        <Choice
          label={t.dark}
          value={p.appearance.dark}
          options={['theme', 'system', 'light', 'dark'] as const}
          names={(v) => t.darkNames[v]}
          hint={t.darkHint}
          onChange={(v) => save('appearance', 'dark', v)}
        />
      </section>

      <section className="pref-group" aria-labelledby="pref-playback">
        <h3 id="pref-playback">{t.playback}</h3>
        <Choice
          label={t.replayGain}
          value={p.playback.replayGain}
          options={['auto', 'album', 'track', 'off'] as const}
          names={(v) => t.replayGainNames[v]}
          hint={t.replayGainHint}
          onChange={(v) => save('playback', 'replayGain', v)}
        />
        <Choice
          label={t.quality}
          value={p.playback.quality}
          options={['auto', 'raw', '320', '192', '128'] as const}
          names={(v) => t.qualityNames[v]}
          hint={t.perDevice}
          onChange={(v) => save('playback', 'quality', v)}
        />
        <Toggle
          label={t.scrobble}
          checked={p.playback.scrobble}
          onChange={(v) => save('playback', 'scrobble', v)}
        />
        <Toggle
          label={t.autoplay}
          checked={p.playback.autoplay}
          onChange={(v) => save('playback', 'autoplay', v)}
        />
        <p className="field-hint">{t.autoplayHint}</p>
        <div className="pref-slider">
          <p className="pref-label" aria-hidden="true">
            {t.crossfade}{' '}
            <span className="num field-hint">{t.crossfadeText(p.playback.crossfadeSec)}</span>
          </p>
          <Slider
            label={t.crossfade}
            value={p.playback.crossfadeSec}
            min={0}
            max={MAX_CROSSFADE_S}
            step={1}
            bigStep={3}
            variant="volume"
            valueText={(v) => t.crossfadeText(Math.round(v))}
            bubble={(v) => t.crossfadeText(Math.round(v))}
            onChange={(v) => save('playback', 'crossfadeSec', Math.round(v))}
          />
          <p className="field-hint">{t.crossfadeHint}</p>
        </div>
      </section>

      <EqualizerSection />

      <section className="pref-group" aria-labelledby="pref-karaoke">
        <h3 id="pref-karaoke">{strings.karaoke.progress.title}</h3>
        <Toggle
          label={strings.karaoke.progress.toggle}
          checked={p.playback.karaoke}
          onChange={(v) => save('playback', 'karaoke', v)}
        />
        <p className="field-hint">{strings.karaoke.progress.blurb}</p>
        <KaraokeProgress />
      </section>

      <section className="pref-group" aria-labelledby="pref-lyrics">
        <h3 id="pref-lyrics">{t.lyrics}</h3>
        <Choice
          label={t.size}
          value={p.lyrics.sizeScale}
          options={[0.85, 1, 1.15, 1.3] as const}
          names={(v) => t.sizeNames[String(v) as keyof typeof t.sizeNames]}
          onChange={(v) => save('lyrics', 'sizeScale', v)}
        />
        <div className="pref-slider">
          <p className="pref-label" aria-hidden="true">
            {t.offset}{' '}
            <span className="num field-hint">{t.offsetText(p.lyrics.globalOffsetMs)}</span>
          </p>
          <Slider
            label={t.offset}
            value={p.lyrics.globalOffsetMs}
            min={-2000}
            max={2000}
            step={50}
            bigStep={250}
            variant="volume"
            valueText={(v) => t.offsetText(v)}
            bubble={(v) => t.offsetText(v)}
            onChange={(v) => save('lyrics', 'globalOffsetMs', Math.round(v / 50) * 50)}
          />
          <p className="field-hint">{t.offsetHint}</p>
        </div>
        <Toggle
          label={t.showUnsynced}
          checked={p.lyrics.showUnsynced}
          onChange={(v) => save('lyrics', 'showUnsynced', v)}
        />
        <Toggle
          label={t.announce}
          checked={p.lyrics.announceLines}
          onChange={(v) => save('lyrics', 'announceLines', v)}
        />
        <fieldset className="pref-choice">
          <legend className="pref-label">{t.sources}</legend>
          {Object.entries(t.sourceNames).map(([id, name]) => {
            const off = p.lyrics.disabledSources;
            return (
              <Toggle
                key={id}
                label={name}
                checked={!off.includes(id)}
                onChange={(on) =>
                  save('lyrics', 'disabledSources', on ? off.filter((x) => x !== id) : [...off, id])
                }
              />
            );
          })}
          <p className="field-hint">{t.sourcesHint}</p>
        </fieldset>
      </section>

      <section className="pref-group" aria-labelledby="pref-visuals">
        <h3 id="pref-visuals">{t.visuals}</h3>
        {!webgl2Supported() && (
          <p className="notice">
            <Pill tone="warn">{strings.settings.visualsLimitedPill}</Pill>
            {strings.settings.visualsLimited}
          </p>
        )}
        <Toggle
          label={t.performance}
          checked={p.visuals.performance}
          onChange={(v) => save('visuals', 'performance', v)}
        />
        <p className="field-hint">{t.performanceHint}</p>
        <Choice
          label={t.mode}
          value={p.visuals.mode}
          options={['auto', 'reverb', 'ambient', 'still'] as const}
          names={(v) => t.modeNames[v]}
          hint={perf ? t.setByPerformance : t.modeHint}
          disabled={perf}
          onChange={(v) => save('visuals', 'mode', v)}
        />
        <Choice
          label={t.intensity}
          value={p.visuals.intensity}
          options={['subtle', 'balanced', 'expressive'] as const}
          names={(v) => t.intensityNames[v]}
          {...(perf && { hint: t.setByPerformance })}
          disabled={perf}
          onChange={(v) => save('visuals', 'intensity', v)}
        />
        <Choice
          label={t.motion}
          value={p.visuals.motion}
          options={['system', 'full', 'reduced', 'off'] as const}
          names={(v) => t.motionNames[v]}
          {...(perf && { hint: t.setByPerformance })}
          disabled={perf}
          onChange={(v) => save('visuals', 'motion', v)}
        />
        <Choice
          label={t.visualQuality}
          value={p.visuals.quality}
          options={['auto', 'high', 'balanced', 'low', 'minimal'] as const}
          names={(v) => t.visualQualityNames[v]}
          hint={perf ? t.setByPerformance : t.perDeviceNextVisit}
          disabled={perf}
          onChange={(v) => save('visuals', 'quality', v)}
        />
        <Toggle
          label={t.grain}
          checked={p.visuals.grain}
          onChange={() => {}}
          disabled
          disabledReason={t.later}
        />
        <Toggle
          label={t.parallax}
          checked={p.visuals.pointerParallax}
          onChange={() => {}}
          disabled
          disabledReason={t.later}
        />
      </section>

      <section className="pref-group" aria-labelledby="pref-keyboard">
        <h3 id="pref-keyboard">{t.keyboard}</h3>
        <dl className="keymap">
          {t.keys.map(([keys, action]) => (
            <div key={keys}>
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
        <p className="field-hint">{t.keysNote}</p>
      </section>

      <section className="pref-group" aria-labelledby="pref-about">
        <h3 id="pref-about">{t.about}</h3>
        {t.aboutText.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </section>
    </div>
  );
}

/** Settings → Playback → Equalizer: on or off, a preset, and the ten bands (eq.ts). */
function EqualizerSection() {
  const p = useStore(prefsStore, (s) => s.playback);
  const gains = eqGains(p.eqPreset, p.eqGains);
  const setBand = (i: number, db: number) => {
    const next = gains.slice();
    next[i] = Math.round(db);
    save('playback', 'eqGains', next);
    if (p.eqPreset !== 'custom') save('playback', 'eqPreset', 'custom');
    if (!p.eq) save('playback', 'eq', true);
  };
  return (
    <section className="pref-group" aria-labelledby="pref-eq">
      <h3 id="pref-eq">{t.equalizer}</h3>
      <Toggle label={t.eqOn} checked={p.eq} onChange={(v) => save('playback', 'eq', v)} />
      <p className="field-hint">{t.eqHint}</p>
      <Choice
        label={t.eqPreset}
        value={p.eqPreset}
        options={EQ_PRESET_IDS}
        names={(v) => t.eqPresetNames[v]}
        onChange={(v) => {
          save('playback', 'eqPreset', v);
          if (!p.eq) save('playback', 'eq', true);
        }}
      />
      <div className="pref-eq" data-off={!p.eq || undefined}>
        {EQ_BANDS.map((hz, i) => (
          <div className="pref-eq-band" key={hz}>
            <span className="pref-eq-hz">{t.eqBand(hz)}</span>
            <Slider
              label={t.eqBand(hz)}
              value={gains[i] ?? 0}
              min={-EQ_MAX_DB}
              max={EQ_MAX_DB}
              step={1}
              bigStep={3}
              variant="volume"
              valueText={(v) => t.eqGainText(Math.round(v))}
              bubble={(v) => t.eqGainText(Math.round(v))}
              onChange={(v) => setBand(i, v)}
            />
            <span className="pref-eq-db num">{t.eqGainText(gains[i] ?? 0)}</span>
          </div>
        ))}
      </div>
      <p className="field-hint">{t.eqBandsHint}</p>
    </section>
  );
}

/** The server's progress through the library (docs/KARAOKE.md), asked for when Settings opens. */
function KaraokeProgress() {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const k = strings.karaoke.progress;
    api<{
      enabled: boolean;
      online?: boolean;
      ready?: number;
      queued?: number;
      failed?: number;
      skipped?: number;
      bytes?: number | null;
    }>('/karaoke')
      .then((r) => {
        if (!live) return;
        if (!r.enabled) return setLine(k.notSetUp);
        if (!r.online) return setLine(k.offline);
        const ready = r.ready ?? 0;
        const total = ready + (r.queued ?? 0) + (r.failed ?? 0) + (r.skipped ?? 0);
        setLine(k.line(ready, total, ((r.bytes ?? 0) / 1e9).toFixed(1), r.failed ?? 0));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return line ? <p className="pref-label">{line}</p> : null;
}
