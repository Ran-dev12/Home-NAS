import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Check, CircleAlert, CircleCheck, Copy, Eye, EyeOff, Info, LoaderCircle, X } from 'lucide-react';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type IconType = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

// ---- Buttons -----------------------------------------------------------------------------------------

const VARIANTS = {
  primary: 'bg-primary-solid text-primary-fg hover:bg-primary-solid-hover',
  secondary: 'bg-card text-fg border border-line hover:bg-subtle',
  ghost: 'text-fg hover:bg-subtle',
  danger: 'bg-danger-solid text-white hover:opacity-90',
} as const;

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: keyof typeof VARIANTS;
  size?: 'sm' | 'md';
  icon?: IconType;
  loading?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, loading, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon: Icon,
  className,
  active,
  ...rest
}: { label: string; icon: IconType; active?: boolean } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-subtle hover:text-fg',
        className,
      )}
      {...rest}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}

// ---- Form fields ---------------------------------------------------------------------------------------

export function Field({ label, hint, error, children, id }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; id?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p className="flex items-center gap-1.5 text-sm text-danger" role="alert">
          <CircleAlert className="size-4 shrink-0" aria-hidden /> {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const inputClass =
  'h-10 w-full rounded-lg border border-line bg-card px-3 text-base text-fg placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/25 focus:outline-none sm:text-sm';

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx(inputClass, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<'select'>) {
  return (
    <select className={cx(inputClass, 'cursor-pointer pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

// ---- Feedback --------------------------------------------------------------------------------------

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cx('inline-flex items-center gap-2 text-muted', className)}>
      <LoaderCircle className="size-5 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: IconType; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-subtle text-muted">
        <Icon className="size-7" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="text-sm leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', title, children, action }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; title?: string; children?: ReactNode; action?: ReactNode }) {
  const styles = {
    info: 'bg-primary-soft text-fg border-primary/30',
    warn: 'bg-warn-soft text-fg border-warn/40',
    danger: 'bg-danger-soft text-fg border-danger/40',
    ok: 'bg-ok-soft text-fg border-ok/40',
  }[tone];
  const Icon = tone === 'ok' ? CircleCheck : tone === 'info' ? Info : CircleAlert;
  const iconColor = { info: 'text-primary', warn: 'text-warn', danger: 'text-danger', ok: 'text-ok' }[tone];
  return (
    <div className={cx('flex gap-3 rounded-xl border p-3 text-sm', styles)} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon className={cx('mt-0.5 size-5 shrink-0', iconColor)} aria-hidden />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
      {action}
    </div>
  );
}

export function ProgressBar({ value, tone = 'primary', label }: { value: number; tone?: 'primary' | 'warn' | 'danger' | 'ok'; label?: string }) {
  const color = { primary: 'bg-primary', warn: 'bg-warn', danger: 'bg-danger', ok: 'bg-ok' }[tone];
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cx('h-full rounded-full transition-[width] duration-300', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'primary' | 'warn' | 'ok' | 'danger' }) {
  const s = {
    neutral: 'bg-subtle text-muted',
    primary: 'bg-primary-soft text-primary',
    warn: 'bg-warn-soft text-warn',
    ok: 'bg-ok-soft text-ok',
    danger: 'bg-danger-soft text-danger',
  }[tone];
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', s)}>{children}</span>;
}

// ---- Clipboard (works on plain-http LAN addresses, where navigator.clipboard does not exist) ------------

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length); // iOS
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

export function CopyButton({ text, label = 'Copy', size = 'sm' }: { text: string; label?: string; size?: 'sm' | 'md' }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  return (
    <Button
      size={size}
      icon={done ? Check : Copy}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } else toast('Could not copy. Select the text and copy it manually.', 'error');
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  );
}

export function CopyField({ label, value, secret, hint }: { label: string; value: string; secret?: boolean; hint?: ReactNode }) {
  const [shown, setShown] = useState(!secret);
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <div className="flex gap-2">
        <input
          id={id}
          readOnly
          value={shown ? value : '•'.repeat(Math.min(value.length, 24))}
          onFocus={(e) => shown && e.currentTarget.select()}
          className={cx(inputClass, 'font-mono text-sm sm:text-sm')}
        />
        {secret && <IconButton label={shown ? 'Hide' : 'Show'} icon={shown ? EyeOff : Eye} onClick={() => setShown(!shown)} />}
        <CopyButton text={value} size="md" />
      </div>
    </Field>
  );
}

// ---- Modal (native <dialog>: focus trap, Escape and top-layer for free) ------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size];
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx('m-auto w-[calc(100vw-1.5rem)] rounded-2xl border border-line bg-card p-0 shadow-2xl', width)}
    >
      {open && (
        <div className="flex max-h-[88dvh] flex-col">
          <div className="flex items-center gap-3 border-b border-line px-5 py-3">
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
            <IconButton label="Close" icon={X} onClick={onClose} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

// ---- Toasts --------------------------------------------------------------------------------------------

type ToastKind = 'ok' | 'error' | 'info';
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; kind: ToastKind }[]>([]);
  const push = useCallback((msg: string, kind: ToastKind = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex max-w-md items-center gap-2 rounded-xl border px-4 py-2.5 text-sm shadow-lg',
              t.kind === 'error' ? 'border-danger/40 bg-danger-soft' : 'border-line bg-card',
            )}
          >
            {t.kind === 'error' ? <CircleAlert className="size-4 shrink-0 text-danger" aria-hidden /> : <CircleCheck className="size-4 shrink-0 text-ok" aria-hidden />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---- Confirm & prompt dialogs (promise-based) -----------------------------------------------------------

interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  hint?: string;
  inputType?: string;
  /** Select just the name part (before the extension) like Explorer does. */
  selectStem?: boolean;
  /** Throw to keep the dialog open and show the message. */
  onSubmit: (value: string) => Promise<void>;
}

interface DialogApi {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  prompt: (o: PromptOptions) => Promise<boolean>;
}

const DialogCtx = createContext<DialogApi>({ confirm: async () => false, prompt: async () => false });
export const useDialogs = () => useContext(DialogCtx);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirm] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [promptState, setPrompt] = useState<(PromptOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const api: DialogApi = {
    confirm: (o) => new Promise((resolve) => setConfirm({ ...o, resolve })),
    prompt: (o) =>
      new Promise((resolve) => {
        setValue(o.initial ?? '');
        setError(null);
        setPrompt({ ...o, resolve });
      }),
  };

  useEffect(() => {
    if (!promptState) return;
    const t = setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const dot = promptState.selectStem ? el.value.lastIndexOf('.') : -1;
      try {
        el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
      } catch {
        /* date and number inputs do not support selection */
      }
    }, 30);
    return () => clearTimeout(t);
  }, [promptState]);

  const closeConfirm = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirm(null);
  };
  const closePrompt = (v: boolean) => {
    promptState?.resolve(v);
    setPrompt(null);
    setBusy(false);
  };
  const submitPrompt = async () => {
    if (!promptState) return;
    setBusy(true);
    setError(null);
    try {
      await promptState.onSubmit(value.trim());
      closePrompt(true);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <DialogCtx.Provider value={api}>
      {children}
      <Modal
        open={!!confirmState}
        onClose={() => closeConfirm(false)}
        title={confirmState?.title}
        size="sm"
        footer={
          <>
            <Button onClick={() => closeConfirm(false)}>Cancel</Button>
            <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => closeConfirm(true)} autoFocus>
              {confirmState?.confirmLabel ?? 'OK'}
            </Button>
          </>
        }
      >
        <div className="text-sm leading-relaxed text-muted">{confirmState?.body}</div>
      </Modal>
      <Modal
        open={!!promptState}
        onClose={() => closePrompt(false)}
        title={promptState?.title}
        size="sm"
        footer={
          <>
            <Button onClick={() => closePrompt(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!value.trim()} onClick={submitPrompt}>
              {promptState?.confirmLabel ?? 'Save'}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) void submitPrompt();
          }}
        >
          <Field label={promptState?.label ?? ''} error={error} hint={promptState?.hint} id="prompt-input">
            <Input id="prompt-input" ref={inputRef} type={promptState?.inputType ?? 'text'} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
          </Field>
        </form>
      </Modal>
    </DialogCtx.Provider>
  );
}

// ---- Dropdown menu -------------------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  icon?: IconType;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}

export function Menu({
  label,
  icon,
  items,
  align = 'right',
  up = false,
}: {
  label: string;
  icon: IconType;
  items: MenuItem[];
  align?: 'left' | 'right';
  /** Open above the button (for menus at the bottom of the screen). */
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return null;
  return (
    <div className="relative" ref={ref}>
      <IconButton label={label} icon={icon} aria-haspopup="menu" aria-expanded={open} onClick={(e) => (e.stopPropagation(), setOpen(!open))} />
      {open && (
        <div
          role="menu"
          className={cx(
            'absolute z-40 min-w-48 overflow-hidden rounded-xl border border-line bg-card py-1 text-fg shadow-xl',
            up ? 'bottom-full mb-1' : 'mt-1',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {visible.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              type="button"
              className={cx('flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-subtle', it.danger && 'text-danger')}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                it.onClick();
              }}
            >
              {it.icon && <it.icon className="size-4 shrink-0" aria-hidden />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('rounded-2xl border border-line bg-card', className)}>{children}</section>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-5 pb-3 md:px-8 md:pt-8">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
