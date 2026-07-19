import {
  type ButtonHTMLAttributes,
  type AriaRole,
  type PropsWithChildren,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from 'react';
import { AlertCircle, Inbox, LoaderCircle, X } from 'lucide-react';
import { ApiError } from '../lib/api';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function PaperCard({
  children,
  className = '',
  as: Element = 'section',
  role,
}: PropsWithChildren<{
  className?: string;
  as?: 'section' | 'article' | 'div';
  role?: AriaRole;
}>) {
  return <Element className={`paper-card ${className}`} role={role}>{children}</Element>;
}

export function Stamp({
  children,
  tone = 'neutral',
}: PropsWithChildren<{ tone?: 'good' | 'warn' | 'bad' | 'purple' | 'neutral' }>) {
  return <span className={`stamp stamp--${tone}`}>{children}</span>;
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
}) {
  return <button className={`button button--${variant} ${className}`} {...props} />;
}

export function SkeletonGrid({ cards = 4 }: { cards?: number }) {
  return (
    <div className="skeleton-grid" aria-busy="true" aria-label="Loading">
      {Array.from({ length: cards }, (_, index) => (
        <div className="skeleton-card" key={index}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: PropsWithChildren<{ title: string; action?: ReactNode }>) {
  return (
    <PaperCard className="empty-state">
      <Inbox aria-hidden="true" />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </PaperCard>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const apiError = error instanceof ApiError ? error : null;
  return (
    <PaperCard className="error-state" role="alert">
      <AlertCircle aria-hidden="true" />
      <div>
        <h2>We lost the thread</h2>
        <p>{error instanceof Error ? error.message : 'This page could not be loaded.'}</p>
        {apiError?.requestId && <small>Reference: {apiError.requestId}</small>}
      </div>
      {onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    </PaperCard>
  );
}

export function InlineSpinner({ label = 'Saving' }: { label?: string }) {
  return <span className="inline-spinner"><LoaderCircle aria-hidden="true" />{label}</span>;
}

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage(page: number): void;
}) {
  if (totalPages <= 1) return total ? <p className="pagination-summary">{total} total</p> : null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <Button
        variant="quiet"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </Button>
      <span>Page {page} of {totalPages} · {total} entries</span>
      <Button
        variant="quiet"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  reason,
  reasonLabel = 'Reason',
  reasonRequired = false,
  reasonValidator,
  reasonError,
  busy = false,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  reason?: string;
  reasonLabel?: string;
  reasonRequired?: boolean;
  reasonValidator?(value: string): boolean;
  reasonError?: string;
  busy?: boolean;
  onReasonChange?(value: string): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('button, input, textarea')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
      if (event.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled])',
      ));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [onCancel, open]);

  if (!open) return null;
  const reasonValue = reason ?? '';
  const reasonValid = reasonValidator
    ? reasonValidator(reasonValue)
    : !reasonRequired || reasonValue.trim().length >= 4;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={panelRef}
      >
        <button className="dialog-close" aria-label="Close dialog" onClick={onCancel}>
          <X aria-hidden="true" />
        </button>
        <p className="eyebrow">{destructive ? 'Careful step' : 'Please confirm'}</p>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{description}</p>
        {onReasonChange && (
          <label className="field">
            <span>{reasonLabel}{reasonRequired ? ' (required)' : ''}</span>
            <textarea
              value={reasonValue}
              onChange={(event) => onReasonChange(event.target.value)}
              minLength={reasonRequired ? 4 : undefined}
              maxLength={500}
              rows={4}
              placeholder="Add a clear note for the audit trail"
              aria-invalid={!reasonValid && reasonValue.length > 0}
              aria-describedby={reasonError ? `${descriptionId}-reason-error` : undefined}
            />
            {reasonError && !reasonValid && reasonValue.length > 0 && (
              <small id={`${descriptionId}-reason-error`} role="alert">{reasonError}</small>
            )}
          </label>
        )}
        <div className="dialog-actions">
          <Button variant="quiet" onClick={onCancel} disabled={busy}>Keep things as they are</Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy || !reasonValid}
          >
            {busy ? <InlineSpinner /> : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
