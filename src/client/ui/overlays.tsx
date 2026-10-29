import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useStore } from 'zustand';
import { strings } from '../strings.ts';
import { Button, IconButton } from './controls.tsx';
import { attachGlass } from './glass.ts';
import type { IconName } from './icons.tsx';
import { menuMove, toastStore } from './logic.ts';

// Sheet, menu, dialog and toast (DESIGN_SYSTEM.md §9.6). Sheet and dialog are native modal
// <dialog>s: the browser contains focus, makes the rest inert, and closes on Esc.

/** Opens/closes a <dialog> with `open`, returns focus to where it was, reports every close. */
function useModal(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => attachGlass(ref.current), []); // sheets and dialogs are glass (§7.11)
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);
  const handleClose = () => {
    onClose();
    returnTo.current?.focus();
  };
  // A click whose target is the <dialog> itself but outside its box landed on the backdrop.
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    const inside =
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) e.currentTarget.close();
  };
  return { ref, handleClose, onBackdrop };
}

/** Side sheet (queue): 400px from the trailing edge, full screen when compact. */
export function Sheet(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const { ref, handleClose, onBackdrop } = useModal(props.open, props.onClose);
  const titleId = useId();
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; keyboard closes with Esc (native)
    <dialog
      ref={ref}
      className="sheet glass"
      aria-labelledby={titleId}
      onClose={handleClose}
      onClick={onBackdrop}
    >
      <header className="sheet-head">
        <h2 id={titleId}>{props.title}</h2>
        <IconButton label={strings.ui.close} icon="close" onClick={() => ref.current?.close()} />
      </header>
      <div className="sheet-body">{props.children}</div>
    </dialog>
  );
}

/**
 * Destructive confirmation (§9.6), the only use of a dialog: names the object, states the
 * consequence, focus starts on Cancel.
 */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  consequence: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmed = useRef(false);
  const { ref, handleClose } = useModal(props.open, () => {
    if (confirmed.current) props.onConfirm();
    else props.onCancel();
    confirmed.current = false;
  });
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useEffect(() => {
    if (props.open) cancel.current?.focus();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      className="dialog glass"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onClose={handleClose}
    >
      <h2 id={titleId}>{props.title}</h2>
      <p id={bodyId}>{props.consequence}</p>
      <div className="dialog-actions">
        <Button ref={cancel} onClick={() => ref.current?.close()}>
          {strings.ui.cancel}
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            confirmed.current = true;
            ref.current?.close();
          }}
        >
          {props.confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

/** Menu button (§9.6; ARIA menu button pattern): opens from its trigger, arrows move, Esc closes. */
export function Menu({
  label,
  items,
  icon = 'more',
}: {
  label: string;
  items: MenuItem[];
  icon?: IconName;
}) {
  const [active, setActive] = useState<number | null>(null); // null = closed
  const open = active !== null;
  const menuId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const disabled = items.map((i) => !!i.disabled);

  // Open upward when the menu would run past the bottom of its scroll container (the canvas
  // ends above the dock) or the window; align to the trigger's left edge when, right-aligned, it
  // would leave the window on the left (a trigger near the left edge). Measured before paint, so
  // it never flashes.
  const menu = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');
  const [align, setAlign] = useState<'end' | 'start'>('end');
  useLayoutEffect(() => {
    const el = menu.current;
    if (!open || !el) {
      setAlign('end');
      return setPlacement('bottom');
    }
    if (el.getBoundingClientRect().left < 0) setAlign('start');
    let limit = window.innerHeight;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowY)) {
        limit = Math.min(limit, p.getBoundingClientRect().bottom);
        break;
      }
    }
    const below = el.getBoundingClientRect().bottom <= limit;
    const room = (trigger.current?.getBoundingClientRect().top ?? 0) > el.offsetHeight;
    setPlacement(below || !room ? 'bottom' : 'top');
  }, [open]);

  useEffect(() => {
    if (active !== null && active >= 0) refs.current[active]?.focus({ preventScroll: true });
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setActive(null);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const close = (refocus: boolean) => {
    setActive(null);
    if (refocus) trigger.current?.focus();
  };

  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(menuMove(-1, e.key, disabled));
    }
  };

  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') close(false);
    else {
      const next = menuMove(active ?? -1, e.key, disabled);
      if (next !== active) {
        e.preventDefault();
        setActive(next);
      }
    }
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <IconButton
        ref={trigger}
        label={label}
        icon={icon}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setActive(menuMove(-1, 'Home', disabled)))}
        onKeyDown={onTriggerKey}
      />
      {open && (
        <div
          ref={menu}
          className="menu"
          role="menu"
          id={menuId}
          aria-label={label}
          data-placement={placement}
          data-align={align}
          onKeyDown={onMenuKey}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={item.destructive ? 'menu-item menu-item--destructive' : 'menu-item'}
              aria-disabled={item.disabled || undefined}
              onClick={() => {
                if (item.disabled) return;
                close(true);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The one toast slot (§9.6): a status region that always exists, bottom-centre above the dock. */
export function ToastRegion() {
  const toast = useStore(toastStore, (s) => s.toast);
  return (
    <div className="toast-region" role="status">
      {toast && (
        <div key={toast.id} className="toast" data-leaving={toast.leaving || undefined}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
