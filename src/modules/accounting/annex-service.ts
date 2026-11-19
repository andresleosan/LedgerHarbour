import { listPrivatelyPaidInvoices, listUnpaidInvoices, type InvoiceCreditorItem } from "../invoices/invoice-payment-service";
import type { InvoiceDependencies } from "../invoices/invoice-service";
import { defaultOnboardingRepository, resolveOnboardingActor, type OnboardingActor } from "../tenancy/business-service";
import type { BusinessId } from "../tenancy/types";
import { annexCsv } from "./annex-csv";
import { listHeadings } from "./heading-service";
import { formatPence, parsePounds, sumPence } from "./money";
import { MONEY_ERROR_CODES, MoneyError } from "./money-repository";
import { listFinancialYears, listMoneyAccounts, listMovements, type MoneyDependencies } from "./money-service";

// The year-end items the workbook does not carry: creditors, capital introduced through
// invoices paid privately, and fixed-asset movements. A separate file; the template is
// never read or written here.

export type AnnexDependencies = MoneyDependencies & InvoiceDependencies;

export interface AnnexInvoice extends InvoiceCreditorItem {
  undated: boolean;
}

export interface AnnexAssetLine {
  movementId: string;
  date: string;
  narrative: string;
  /** Always positive: the cost of a purchase, or the money received. */
  amount: string;
  headingName: string;
  accountName: string;
}

export interface AnnexTotal {
  count: number;
  /** Ordered by currency; amounts of different currencies are never added together. */
  byCurrency: Array<{ currency: string; count: number; amount: string }>;
}

export interface YearAnnex {
  year: { id: string; startDate: string; endDate: string };
  unpaidInvoices: AnnexInvoice[];
  privatelyPaidInvoices: AnnexInvoice[];
  assetPurchases: AnnexAssetLine[];
  assetReceipts: AnnexAssetLine[];
  totals: Record<"unpaidInvoices" | "privatelyPaidInvoices" | "assetPurchases" | "assetReceipts", AnnexTotal>;
}

/** The annex for the screen; no file, no audit event. */
export async function buildYearAnnex(businessId: BusinessId, yearId: string, actor: OnboardingActor, dependencies: AnnexDependencies = {}): Promise<YearAnnex> {
  // Authorizes read_finance on an operational business, with the money service's errors.
  const year = (await listFinancialYears(businessId, actor, dependencies)).find((stored) => stored.id === yearId);
  if (!year) throw new MoneyError(MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND);

  const invoices = (items: InvoiceCreditorItem[], keep: (date: string) => boolean): AnnexInvoice[] => items
    .filter((item) => item.invoiceDate === null || keep(item.invoiceDate))
    .map((item) => ({ ...item, total: item.total === null ? null : formatPence(parsePounds(item.total)), undated: item.invoiceDate === null }))
    .sort((left, right) => Number(left.undated) - Number(right.undated) || (left.invoiceDate ?? "").localeCompare(right.invoiceDate ?? "") || (left.supplier ?? "").localeCompare(right.supplier ?? "") || left.id.localeCompare(right.id));
  const unpaidInvoices = invoices(await listUnpaidInvoices(businessId, actor, dependencies), (date) => date <= year.endDate);
  const privatelyPaidInvoices = invoices(await listPrivatelyPaidInvoices(businessId, actor, dependencies), (date) => year.startDate <= date && date <= year.endDate);

  const headings = new Map((await listHeadings(businessId, actor, dependencies)).filter((h) => h.group === "assets").map((h) => [h.id, h.displayName]));
  const accounts = new Map((await listMoneyAccounts(businessId, {}, actor, dependencies)).map((a) => [a.id, a.name]));
  const assetPurchases: AnnexAssetLine[] = [];
  const assetReceipts: AnnexAssetLine[] = [];
  for (const movement of await listMovements(businessId, { yearId: year.id }, actor, dependencies)) {
    const headingName = movement.headingId === null ? undefined : headings.get(movement.headingId);
    if (headingName === undefined) continue;
    const pence = parsePounds(movement.amount);
    (pence < 0 ? assetPurchases : assetReceipts).push({
      movementId: movement.id,
      date: movement.movementDate,
      narrative: movement.narrative,
      amount: formatPence(Math.abs(pence)),
      headingName,
      accountName: accounts.get(movement.moneyAccountId) ?? "",
    });
  }

  return {
    year: { id: year.id, startDate: year.startDate, endDate: year.endDate },
    unpaidInvoices,
    privatelyPaidInvoices,
    assetPurchases,
    assetReceipts,
    totals: {
      unpaidInvoices: total(unpaidInvoices.map((i) => ({ currency: i.currency ?? "", amount: i.total }))),
      privatelyPaidInvoices: total(privatelyPaidInvoices.map((i) => ({ currency: i.currency ?? "", amount: i.total }))),
      assetPurchases: total(assetPurchases.map((a) => ({ currency: "GBP", amount: a.amount }))),
      assetReceipts: total(assetReceipts.map((a) => ({ currency: "GBP", amount: a.amount }))),
    },
  };
}

/** The annex as the CSV file that travels with the workbook; records one audit event, with counts only. */
export async function downloadYearAnnex(businessId: BusinessId, yearId: string, actor: OnboardingActor, dependencies: AnnexDependencies = {}): Promise<{ annex: YearAnnex; csv: string }> {
  const annex = await buildYearAnnex(businessId, yearId, actor, dependencies);
  const csv = annexCsv(annex);
  const tenancy = dependencies.tenancyRepository ?? defaultOnboardingRepository;
  const actorId = await resolveOnboardingActor(tenancy, actor);
  await tenancy.transaction((transaction) => transaction.appendAuditEvent({
    businessId,
    actorId,
    type: "annex_downloaded",
    entityId: annex.year.id,
    metadata: {
      financialYearId: annex.year.id,
      unpaidInvoices: annex.unpaidInvoices.length,
      privatelyPaidInvoices: annex.privatelyPaidInvoices.length,
      assetPurchases: annex.assetPurchases.length,
      assetReceipts: annex.assetReceipts.length,
    },
  }));
  return { annex, csv };
}

/** Counts every row; sums per currency in integer pence. A row with no amount is counted, not summed. */
function total(rows: Array<{ currency: string; amount: string | null }>): AnnexTotal {
  const byCurrency = new Map<string, { count: number; pence: number[] }>();
  for (const row of rows) {
    const entry = byCurrency.get(row.currency) ?? byCurrency.set(row.currency, { count: 0, pence: [] }).get(row.currency)!;
    entry.count++;
    if (row.amount !== null) entry.pence.push(parsePounds(row.amount));
  }
  return {
    count: rows.length,
    byCurrency: [...byCurrency].sort(([a], [b]) => a.localeCompare(b)).map(([currency, { count, pence }]) => ({ currency, count, amount: formatPence(sumPence(pence)) })),
  };
}
