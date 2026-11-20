import { defaultOnboardingRepository, resolveOnboardingActor, type OnboardingActor } from "../tenancy/business-service";
import type { BusinessId } from "../tenancy/types";
import { HeadingError, requireHeadingCapability } from "./heading-service";
import { parsePounds, sumPence } from "./money";
import { MONEY_ERROR_CODES, MoneyError, resolveDefaultMoneyRepository } from "./money-repository";
import type { MoneyDependencies } from "./money-service";

// Totals of a financial year in integer pence. The export's read-back recomputes this
// from the written cells and compares it with the one computed from the stored rows.

export interface YearSummaryInput {
  accounts: Array<{ id: string; openingBalance: string }>;
  movements: Array<{ moneyAccountId: string; headingId: string | null; amount: string }>;
}

export interface YearSummary {
  /** By heading id; movements with no heading are only counted in `uncodedCount`. */
  byHeading: Array<{ headingId: string; pence: number; count: number }>;
  /** By account id; closing = opening + movements. */
  byAccount: Array<{ accountId: string; openingPence: number; movementsPence: number; closingPence: number; count: number }>;
  uncodedCount: number;
}

export function summarizeYear(input: YearSummaryInput): YearSummary {
  const headings = new Map<string, number[]>();
  const accounts = new Map<string, { opening: number; amounts: number[] }>(input.accounts.map((a) => [a.id, { opening: parsePounds(a.openingBalance), amounts: [] }]));
  let uncodedCount = 0;
  for (const movement of input.movements) {
    const pence = parsePounds(movement.amount);
    if (movement.headingId === null) uncodedCount++;
    else (headings.get(movement.headingId) ?? headings.set(movement.headingId, []).get(movement.headingId)!).push(pence);
    if (!accounts.has(movement.moneyAccountId)) accounts.set(movement.moneyAccountId, { opening: 0, amounts: [] });
    accounts.get(movement.moneyAccountId)!.amounts.push(pence);
  }
  const byId = <T extends object>(key: keyof T) => (a: T, b: T) => String(a[key]).localeCompare(String(b[key]));
  return {
    byHeading: [...headings].map(([headingId, amounts]) => ({ headingId, pence: sumPence(amounts), count: amounts.length })).sort(byId("headingId")),
    byAccount: [...accounts].map(([accountId, { opening, amounts }]) => {
      const movementsPence = sumPence(amounts);
      return { accountId, openingPence: opening, movementsPence, closingPence: sumPence([opening, movementsPence]), count: amounts.length };
    }).sort(byId("accountId")),
    uncodedCount,
  };
}

/** The year's summary over the accounts the export writes, for members with `read_finance`. */
export async function getYearSummary(businessId: BusinessId, yearId: string, actor: OnboardingActor, dependencies: MoneyDependencies = {}): Promise<YearSummary> {
  const tenancy = dependencies.tenancyRepository ?? defaultOnboardingRepository;
  const money = dependencies.money ?? resolveDefaultMoneyRepository();
  const actorId = await resolveOnboardingActor(tenancy, actor);
  if (typeof businessId !== "string" || !businessId.trim()) throw new MoneyError(MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  try {
    await requireHeadingCapability(businessId, actorId, tenancy, "read_finance");
  } catch (error) {
    throw error instanceof HeadingError && error.code in MONEY_ERROR_CODES ? new MoneyError(error.code as MoneyError["code"]) : error;
  }
  const year = typeof yearId === "string" ? await money.findYear(yearId, businessId) : null;
  if (!year) throw new MoneyError(MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND);
  const openings = await money.listOpenings(businessId, year.id);
  const movements = await money.listMovements(businessId, year.id);
  // The export's rule: an inactive account appears only when it has movements this year.
  const withMovements = new Set(movements.map((m) => m.moneyAccountId));
  const accounts = (await money.listAccounts(businessId)).filter((a) => a.isActive || withMovements.has(a.id))
    .map((account) => ({ id: account.id, openingBalance: openings.get(account.id) ?? "0.00" }));
  return summarizeYear({ accounts, movements });
}
