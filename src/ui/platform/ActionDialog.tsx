"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    if (open) {
      setReason("");
      setServiceExpiresAt("");
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="platform-dialog-backdrop" role="presentation">
      <div className="platform-dialog" role="dialog" aria-modal="true" aria-labelledby="platform-dialog-title">
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
