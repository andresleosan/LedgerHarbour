"use client";

import Link from "next/link";
import { use, useEffect, useState, type ReactNode } from "react";

import { messages } from "@/i18n/config";
import type { ExportBlocker, ExportReport } from "@/modules/accounting/export-service";
import type { AccountHeading, HeadingGroup } from "@/modules/accounting/heading-service";
import { formatPence, parsePounds, sumPence } from "@/modules/accounting/money";
import type { FinancialYear, Movement } from "@/modules/accounting/money-repository";
import type { MoneyAccountWithOpening } from "@/modules/accounting/money-service";
import type { YearSummary } from "@/modules/accounting/year-summary";
import type { TemplateDefect } from "@/modules/workbook/template-profile";
import { useUrlLocale } from "@/ui/useUrlLocale";

type Data = { summary: YearSummary; report: ExportReport; accounts: MoneyAccountWithOpening[]; headings: AccountHeading[]; movements: Movement[]; invoices: { unpaid: number; paidPrivately: number } | null };

const GROUPS: HeadingGroup[] = ["income", "cost_of_sales", "expenses", "assets", "liabilities", "equity"];

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
const plural = (forms: { one: string; other: string }, count: number) => count === 1 ? forms.one : forms.other;

// The template defect sentences of the settings screen, worded from the report.
function adviceFor(report: ExportReport, headings: AccountHeading[], copy: typeof messages.en.workbookSettings, locale: string): string[] {
  const list = (items: string[]) => new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
  const defects = (code: TemplateDefect["code"]) => report.defects.filter((defect) => defect.code === code);
  const sheets = (code: TemplateDefect["code"]) => [...new Set(defects(code).flatMap((defect) => defect.sheet ? [defect.sheet] : []))];
  const advice: string[] = [];
  const broken = defects("BROKEN_REFERENCE").reduce((sum, defect) => sum + (defect.detail.cells ?? 0), 0);
  if (broken > 0) advice.push(fill(plural(copy.defects.brokenReference, broken), { count: broken }));
  const short = report.sheets.filter((sheet) => sheets("TRUNCATED_ANALYSIS_COLUMN").includes(sheet.sheetName));
  if (short.length > 0) advice.push(fill(copy.defects.truncatedColumn, { sheets: list(short.map((sheet) => fill(copy.defects.sheetRows, { name: sheet.sheetName, rows: sheet.capacity }))) }));
  const stale = sheets("STALE_CLOSING_BALANCE");
  if (stale.length > 0) advice.push(fill(copy.defects.staleClosingBalance, { sheets: list(stale) }));
  const unconsolidated = sheets("UNCONSOLIDATED_SHEET");
  if (unconsolidated.length > 0) advice.push(fill(plural(copy.defects.unconsolidatedSheet, unconsolidated.length), { sheets: list(unconsolidated) }));
  const positions = new Set([...defects("HEADING_TOTAL_NOT_READ"), ...defects("HEADING_TOTAL_READ_TWICE")].map((defect) => defect.position));
  const unusable = headings.filter((heading) => positions.has(heading.position)).map((heading) => heading.displayName);
  if (unusable.length > 0) advice.push(fill(plural(copy.defects.headingTotal, unusable.length), { headings: list(unusable) }));
  const blank = defects("BLANK_HEADING").length;
  if (blank > 0) advice.push(fill(plural(copy.defects.blankHeading, blank), { count: blank }));
  return advice;
}

export default function YearPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params);
  const { locale, hrefFor } = useUrlLocale();
  const copy = messages[locale].yearSummary;
  const settingsCopy = messages[locale].workbookSettings;
  const api = `/api/businesses/${businessId}`;
  const [years, setYears] = useState<FinancialYear[] | null>(null);
  const [yearId, setYearId] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = async (chosen?: string) => {
    setLoading(true);
    try {
      const yearsResponse = await fetch(`${api}/financial-years`);
      if (yearsResponse.status === 403) { setForbidden(true); return; }
      if (!yearsResponse.ok) throw new Error();
      // The open year first, then the others from the newest.
      const loadedYears = (await yearsResponse.json() as FinancialYear[]).sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || b.startDate.localeCompare(a.startDate));
      const year = loadedYears.find((item) => item.id === chosen) ?? loadedYears[0];
      setYears(loadedYears);
      setYearId(year?.id ?? "");
      if (year) {
        const id = encodeURIComponent(year.id);
        const responses = await Promise.all([
          fetch(`${api}/financial-years/${id}/summary`),
          fetch(`${api}/financial-years/${id}/export/report`),
          fetch(`${api}/money-accounts?yearId=${id}`),
          fetch(`${api}/headings`),
          fetch(`${api}/movements?yearId=${id}`),
        ]);
        if (responses.some((response) => response.status === 403)) { setForbidden(true); return; }
        if (responses.some((response) => !response.ok)) throw new Error();
        const [summary, report, accounts, headings, movements] = await Promise.all(responses.map((response) => response.json())) as [YearSummary, ExportReport, MoneyAccountWithOpening[], AccountHeading[], Movement[]];
        const invoicesResponse = await fetch(`${api}/invoices/unpaid`);
        const invoices = invoicesResponse.ok ? await invoicesResponse.json() as { unpaid: unknown[]; paidPrivately: unknown[] } : null;
        setData({ summary, report, accounts, headings, movements, invoices: invoices && { unpaid: invoices.unpaid.length, paidPrivately: invoices.paidPrivately.length } });
      } else {
        setData(null);
      }
      setLoadError(false);
      setLoadedAt(new Date());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [businessId]);

  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  const pounds = (pence: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "GBP", currencyDisplay: "narrowSymbol" }).format(formatPence(pence) as `${number}`);
  const fixLink = (path: string, label: string) => <> <Link className="money-link" href={hrefFor(`/business/${businessId}${path}`)}>{label}</Link></>;
  const exportUrl = `${api}/financial-years/${encodeURIComponent(yearId)}`;

  const blockerSentence = (blocker: ExportBlocker, { accounts, movements }: Data): ReactNode => {
    const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? id;
    switch (blocker.code) {
      case "UNCODED_MOVEMENTS": return <>{fill(plural(copy.blockers.UNCODED_MOVEMENTS, blocker.count), { count: blocker.count })}{fixLink("/movements/import", copy.fixLinks.tray)}</>;
      case "UNUSABLE_HEADING": {
        const count = movements.filter((movement) => movement.headingId !== null && blocker.headingIds.includes(movement.headingId)).length;
        return <>{fill(plural(copy.blockers.UNUSABLE_HEADING, count), { count })}{fixLink("/movements", copy.fixLinks.movements)}</>;
      }
      case "ACCOUNT_SHEET_MISSING": return <>{fill(copy.blockers.ACCOUNT_SHEET_MISSING, { account: accountName(blocker.accountId), sheet: blocker.sheetName })}{fixLink("/settings/accounts", copy.fixLinks.accounts)}</>;
      case "ACCOUNT_SHEET_SHARED": return <>{fill(copy.blockers.ACCOUNT_SHEET_SHARED, { accounts: new Intl.ListFormat(locale, { type: "conjunction" }).format(blocker.accountIds.map(accountName)), sheet: blocker.sheetName })}{fixLink("/settings/accounts", copy.fixLinks.accounts)}</>;
      case "SHEET_CAPACITY_EXCEEDED": return fill(copy.blockers.SHEET_CAPACITY_EXCEEDED, { sheet: blocker.sheetName, capacity: blocker.capacity, rows: blocker.rows });
      case "NO_TEMPLATE": return <>{copy.blockers.NO_TEMPLATE}{fixLink("/settings/workbook", copy.fixLinks.template)}</>;
      case "TEMPLATE_UNREADABLE":
      case "TEMPLATE_NOT_WRITABLE": return <>{copy.blockers[blocker.code]}{fixLink("/settings/workbook", copy.fixLinks.template)}</>;
      case "YEAR_NOT_FOUND": return copy.blockers.YEAR_NOT_FOUND;
      default: return copy.blockers.unknown;
    }
  };

  const renderWorkbook = (current: Data) => {
    const { report } = current;
    if (report.blocked) {
      return (
        <>
          <h3>{copy.blockedTitle}</h3>
          <p className="money-hint">{copy.blockedIntro}</p>
          <ul className="workbook-list">{report.blockers.map((blocker, index) => <li key={index}>{blockerSentence(blocker, current)}</li>)}</ul>
        </>
      );
    }
    const rows = report.sheets.reduce((sum, sheet) => sum + sheet.rowsWritten, 0);
    return (
      <>
        <p>{fill(plural(copy.workbookReady, rows), { count: rows })}</p>
        <div className="page-actions year-actions">
          <a className="primary-button" href={`${exportUrl}/export`} download>{copy.download}</a>
          <a className="tertiary-button" href={`${exportUrl}/annex`} download>{copy.annex}</a>
        </div>
        <ul className="workbook-list year-sheets">{report.sheets.map((sheet) => <li key={sheet.sheetName}>{fill(copy.sheetRows, { name: sheet.sheetName, rows: sheet.rowsWritten, capacity: sheet.capacity })}</li>)}</ul>
      </>
    );
  };

  const renderAdvice = ({ report, headings }: Data) => {
    // Only a template that was read has defects and sheets to talk about.
    if (report.sheets.length === 0) return null;
    const advice = adviceFor(report, headings, settingsCopy, locale);
    if (report.unconsolidatedTransferCount > 0) advice.push(fill(plural(copy.unconsolidatedTransfers, report.unconsolidatedTransferCount), { count: report.unconsolidatedTransferCount }));
    if (report.openingBalancesNeedTrialBalanceEntry) advice.push(copy.openingBalances);
    return (
      <section className="page-card" aria-labelledby="advice-title">
        <h2 id="advice-title">{copy.adviceTitle}</h2>
        <p className="page-description">{settingsCopy.adviceIntro}</p>
        <ul className="workbook-list">{advice.map((sentence) => <li key={sentence}>{sentence}</li>)}</ul>
      </section>
    );
  };

  const renderAccounts = ({ summary, accounts, movements }: Data) => (
    <section className="page-card" aria-labelledby="accounts-title">
      <h2 id="accounts-title">{copy.accountsTitle}</h2>
      <div className="movement-balances">
        {accounts.flatMap((account) => {
          const totals = summary.byAccount.find((row) => row.accountId === account.id);
          if (!totals || (!account.isActive && totals.count === 0)) return [];
          const amounts = movements.filter((movement) => movement.moneyAccountId === account.id).map((movement) => parsePounds(movement.amount));
          const moneyIn = sumPence(amounts.filter((pence) => pence > 0));
          const moneyOut = -sumPence(amounts.filter((pence) => pence < 0));
          return [(
            <article className="movement-balance" key={account.id} aria-labelledby={`account-${account.id}`}>
              <h3 id={`account-${account.id}`}>{account.name}</h3>
              <dl>
                <div><dt>{copy.opening}</dt><dd>{pounds(totals.openingPence)}</dd></div>
                <div><dt>{copy.moneyIn}</dt><dd>{pounds(moneyIn)}</dd></div>
                <div><dt>{copy.moneyOut}</dt><dd>{pounds(moneyOut)}</dd></div>
                <div><dt>{copy.closing}</dt><dd>{pounds(totals.closingPence)}</dd></div>
              </dl>
            </article>
          )];
        })}
      </div>
    </section>
  );

  const renderTotals = ({ summary, headings, invoices }: Data) => {
    const pence = new Map(summary.byHeading.map((row) => [row.headingId, row.pence]));
    const sections = GROUPS.map((group) => ({ group, rows: headings.filter((heading) => heading.group === group && (pence.get(heading.id) ?? 0) !== 0) })).filter((section) => section.rows.length > 0);
    return (
      <section className="page-card" aria-labelledby="totals-title">
        <h2 id="totals-title">{copy.totalsTitle}</h2>
        {sections.length === 0 ? <p className="page-empty">{copy.totalsEmpty}</p> : (
          <div className="movement-balances">
            {sections.map(({ group, rows }) => (
              <article className="movement-balance" key={group} aria-labelledby={`group-${group}`}>
                <h3 id={`group-${group}`}>{settingsCopy.groups[group]}</h3>
                <dl>
                  {rows.map((heading) => <div key={heading.id}><dt>{heading.displayName}</dt><dd>{pounds(pence.get(heading.id)!)}</dd></div>)}
                  <div className="year-subtotal"><dt>{copy.subtotal}</dt><dd>{pounds(sumPence(rows.map((heading) => pence.get(heading.id)!)))}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        )}
        <ul className="workbook-list year-counts">
          <li>{summary.uncodedCount > 0
            ? <Link className="money-link" href={hrefFor(`/business/${businessId}/movements/import`)}>{fill(plural(copy.uncoded, summary.uncodedCount), { count: summary.uncodedCount })}</Link>
            : fill(plural(copy.uncoded, 0), { count: 0 })}</li>
          {invoices && (
            <>
              <li><Link className="money-link" href={`${hrefFor(`/business/${businessId}/invoices`)}&status=unpaid`}>{fill(copy.unpaid, { count: invoices.unpaid })}</Link></li>
              <li>{fill(copy.paidPrivately, { count: invoices.paidPrivately })}</li>
            </>
          )}
        </ul>
      </section>
    );
  };

  return (
    <main className="operational-page settings-page">
      <div className="page-shell settings-shell money-shell">
        <Link className="page-back" href={hrefFor(`/business/${businessId}/invoices`)}>{copy.brand} / {copy.title}</Link>
        <section className="page-card" aria-labelledby="year-title">
          <p className="page-eyebrow">{copy.eyebrow}</p>
          <h1 className="page-title" id="year-title">{copy.title}</h1>
          <p className="page-description">{copy.description}</p>
          {forbidden && <p className="page-empty">{copy.forbidden}</p>}
          {loadError && <p className="page-error" role="alert">{copy.loadError}</p>}
          {!forbidden && years?.length === 0 && <p className="page-empty">{copy.noYear} <Link className="money-link" href={hrefFor(`/business/${businessId}/settings/accounts`)}>{copy.noYearLink}</Link></p>}
          {!forbidden && years && years.length > 0 && (
            <div className="money-field movement-filter">
              <label htmlFor="year-picker">{copy.yearLabel}</label>
              <select className="page-input" id="year-picker" value={yearId} disabled={loading} onChange={(event) => void load(event.target.value)}>
                {years.map((year) => <option key={year.id} value={year.id}>{fill(year.status === "closed" ? copy.closedRange : copy.range, { start: date(year.startDate), end: date(year.endDate) })}</option>)}
              </select>
            </div>
          )}
        </section>

        {!forbidden && data && (
          <>
            <section className="page-card" aria-labelledby="workbook-title">
              <h2 id="workbook-title">{copy.workbookTitle}</h2>
              {renderWorkbook(data)}
            </section>
            {renderAdvice(data)}
            {renderAccounts(data)}
            {renderTotals(data)}
          </>
        )}

        {!forbidden && (
          <div className="page-actions year-refresh">
            <p className="page-feedback" role="status" aria-live="polite">{loading ? copy.loading : loadedAt ? fill(copy.loadedAt, { time: new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(loadedAt) }) : ""}</p>
            <button className="tertiary-button" type="button" disabled={loading} onClick={() => void load(yearId)}>{copy.refresh}</button>
          </div>
        )}
      </div>
    </main>
  );
}
