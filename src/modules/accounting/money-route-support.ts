import { NextResponse } from "next/server";

import { getPersistenceContext } from "../persistence/repository-factory";
import { MONEY_ERROR_CODES, MoneyError, type MoneyErrorCode } from "./money-repository";
import type { MoneyDependencies } from "./money-service";

const NOT_FOUND = new Set<MoneyErrorCode>([
  MONEY_ERROR_CODES.BUSINESS_ACCESS_DENIED,
  MONEY_ERROR_CODES.FINANCIAL_YEAR_NOT_FOUND,
  MONEY_ERROR_CODES.MONEY_ACCOUNT_NOT_FOUND,
  MONEY_ERROR_CODES.MOVEMENT_NOT_FOUND,
  MONEY_ERROR_CODES.HEADING_NOT_FOUND,
]);
const FORBIDDEN = new Set<MoneyErrorCode>([MONEY_ERROR_CODES.INSUFFICIENT_CAPABILITY, MONEY_ERROR_CODES.INACTIVE_BUSINESS]);
const BAD_REQUEST = new Set<MoneyErrorCode>([
  MONEY_ERROR_CODES.INVALID_FINANCIAL_YEAR,
  MONEY_ERROR_CODES.INVALID_MONEY_ACCOUNT,
  MONEY_ERROR_CODES.INVALID_AMOUNT,
  MONEY_ERROR_CODES.INVALID_MOVEMENT,
  MONEY_ERROR_CODES.UNKNOWN_TEMPLATE_SHEET,
]);

/** Shared by the financial-years, money-accounts and movements routes; everything else is a state conflict (409). */
export function moneyErrorResponse(error: unknown): NextResponse {
  if (error instanceof MoneyError) {
    const status = NOT_FOUND.has(error.code) ? 404 : FORBIDDEN.has(error.code) ? 403 : BAD_REQUEST.has(error.code) ? 400 : 409;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "MONEY_REQUEST_FAILED", message: "The accounts request could not be completed." } }, { status: 500 });
}

export function invalidMoneyRequest(): NextResponse {
  return NextResponse.json({ error: { code: "INVALID_MONEY_REQUEST", message: "The accounts request is invalid." } }, { status: 400 });
}

export function identityRequired(): NextResponse {
  return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
}

export async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

export function moneyDependencies(): MoneyDependencies {
  const persistence = getPersistenceContext();
  return {
    tenancyRepository: persistence.tenancyRepository,
    money: persistence.moneyRepository,
    headings: persistence.headingRepository,
    templates: persistence.templateRepository,
  };
}
