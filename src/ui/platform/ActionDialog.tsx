"use client";

import { useEffect, useRef, useState } from "react";

export interface ActionDialogValues {
  reason?: string;
  serviceExpiresAt?: string;
}

interface ActionDialogProps {
  open: boolean;
  title: string;
  description: string;
  actionLabel: string;
  cancelLabel: string;
  reasonLabel: string;
  reasonHint: string;
  expirationLabel: string;
  requiresReason: boolean;
  requiresExpiration: boolean;
  onCancel: () => void;
  onConfirm: (values: ActionDialogValues) => void;
}

export default function ActionDialog({
  open,
  title,
  description,
  actionLabel,
  cancelLabel,
  reasonLabel,
  reasonHint,
  expirationLabel,
  requiresReason,
  requiresExpiration,
  onCancel,
  onConfirm,
}: ActionDialogProps) {
  const [reason, setReason] = useState("");
  const [serviceExpiresAt, setServiceExpiresAt] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setServiceExpiresAt("");
    previousActiveElement.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href]";
    const focusFirst = window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector);
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFirst);
      document.removeEventListener("keydown", handleKeyDown);
      if (previousActiveElement.current?.isConnected) previousActiveElement.current.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="platform-dialog-backdrop" role="presentation">
      <div ref={dialogRef} className="platform-dialog" role="dialog" aria-modal="true" aria-labelledby="platform-dialog-title">
        <h2 id="platform-dialog-title">{title}</h2>
        <p>{description}</p>
        <form onSubmit={(event) => { event.preventDefault(); onConfirm({ reason: reason.trim() || undefined, serviceExpiresAt }); }}>
          {requiresExpiration && (
            <label className="platform-field" htmlFor="platform-service-expires">
              {expirationLabel}
              <input id="platform-service-expires" type="date" value={serviceExpiresAt} onChange={(event) => setServiceExpiresAt(event.target.value)} required />
            </label>
          )}
          {requiresReason && (
            <label className="platform-field" htmlFor="platform-action-reason">
              {reasonLabel}
              <textarea id="platform-action-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={reasonHint} maxLength={1000} required />
            </label>
          )}
          <div className="platform-dialog-actions">
            <button type="button" className="platform-button platform-button-muted" onClick={onCancel}>{cancelLabel}</button>
            <button type="submit" className="platform-button platform-button-primary">{actionLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
