"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { messages } from "@/i18n/config";

type Copy = typeof messages.en.documentList;

interface DocumentActionsProps {
  businessId: string;
  documentId: string;
  fileName: string;
  invoiceId: string | null;
  failed: boolean;
  canRetry: boolean;
  locale: "en" | "es";
  copy: Copy;
}

export default function DocumentActions({ businessId, documentId, fileName, invoiceId, failed, canRetry, locale, copy }: DocumentActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<"retry" | "manual" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const post = (action: "process" | "manual-invoice") => fetch(`/api/documents/${documentId}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  const readAgain = async () => {
    setPending("retry");
    setMessage(null);
    try {
      const response = await post("process");
      if (!response.ok) setMessage(response.status === 502 || response.status === 409 ? copy.readFailed : copy.actionError);
    } catch {
      setMessage(copy.actionError);
    }
    setPending(null);
    router.refresh();
  };

  const fillByHand = async () => {
    setPending("manual");
    setMessage(null);
    try {
      const response = await post("manual-invoice");
      if (response.ok) {
        const { invoiceId: created } = await response.json() as { invoiceId: string };
        router.push(`/business/${businessId}/invoices/${created}?locale=${locale}`);
        return;
      }
      setMessage(copy.actionError);
    } catch {
      setMessage(copy.actionError);
    }
    setPending(null);
    router.refresh();
  };

  return (
    <div className="document-actions-block">
      <div className="document-actions" role="group" aria-label={copy.actionsLabel.replace("{name}", fileName)}>
        {failed && canRetry && <button className="primary-button" type="button" disabled={pending !== null} onClick={readAgain}>{pending === "retry" ? copy.reading : copy.readAgain}</button>}
        {failed && !invoiceId && <button className={canRetry ? "tertiary-button" : "primary-button"} type="button" disabled={pending !== null} onClick={fillByHand}>{pending === "manual" ? copy.creating : copy.fillByHand}</button>}
        {invoiceId && <Link className="tertiary-button" href={`/business/${businessId}/invoices/${invoiceId}?locale=${locale}`}>{copy.openReview}</Link>}
        <a className="tertiary-button" href={`/api/documents/${documentId}/download`} aria-label={copy.downloadLabel.replace("{name}", fileName)}>{copy.download}</a>
      </div>
      {message && <p className="page-error" role="status">{message}</p>}
    </div>
  );
}
