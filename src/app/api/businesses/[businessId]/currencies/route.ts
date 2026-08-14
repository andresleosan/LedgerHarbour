import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { CurrencyError, CURRENCY_ERROR_CODES, deactivateCurrency, listCurrencies, setCurrency } from "../../../../../modules/accounting/currency-service";
import type { BusinessId } from "../../../../../modules/tenancy/types";
import { getPersistenceContext } from "../../../../../modules/persistence/repository-factory";

type RouteContext = { params: Promise<{ businessId: string }> };

const createSchema = z.object({ name: z.string(), symbol: z.string(), decimalCount: z.number(), isoCode: z.string().nullable().optional(), isStandard: z.boolean().optional() }).strict();
const updateSchema = z.object({ currencyId: z.string().min(1), isActive: z.literal(false) }).strict();

function responseFor(error: unknown): NextResponse {
  if (error instanceof CurrencyError) {
    const status = error.code === CURRENCY_ERROR_CODES.CURRENCY_NOT_FOUND || error.code === CURRENCY_ERROR_CODES.BUSINESS_ACCESS_DENIED ? 404 :
      error.code === CURRENCY_ERROR_CODES.CURRENCY_NAME_CONFLICT || error.code === CURRENCY_ERROR_CODES.CURRENCY_REFERENCED ? 409 :
      error.code === CURRENCY_ERROR_CODES.INSUFFICIENT_CAPABILITY || error.code === CURRENCY_ERROR_CODES.INACTIVE_BUSINESS ? 403 :
      error.code === CURRENCY_ERROR_CODES.CURRENCY_REPOSITORY_CONFLICT ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "CURRENCY_REQUEST_FAILED", message: "The currency request could not be completed." } }, { status: 500 });
}

function identity() {
  return getCurrentIdentity();
}

export async function GET(_request: Request, context: RouteContext) {
  const actor = identity();
  if (!actor) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  try {
    const persistence = getPersistenceContext();
    return NextResponse.json(await listCurrencies((await context.params).businessId as BusinessId, actor, {
      tenancyRepository: persistence.tenancyRepository,
      currencies: persistence.currencyRepository,
      invoices: persistence.invoiceRepository,
    }));
  } catch (error) { return responseFor(error); }
}

export async function POST(request: Request, context: RouteContext) {
  const actor = identity();
  if (!actor) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: { code: "INVALID_CURRENCY_REQUEST", message: "The currency request is invalid." } }, { status: 400 }); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_CURRENCY_REQUEST", message: "The currency request is invalid." } }, { status: 400 });
  try {
    const persistence = getPersistenceContext();
    return NextResponse.json(await setCurrency({ ...parsed.data, businessId: (await context.params).businessId as BusinessId }, actor, {
      tenancyRepository: persistence.tenancyRepository,
      currencies: persistence.currencyRepository,
      invoices: persistence.invoiceRepository,
    }), { status: 201 });
  } catch (error) { return responseFor(error); }
}

export async function PATCH(request: Request, context: RouteContext) {
  const actor = identity();
  if (!actor) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: { code: "INVALID_CURRENCY_REQUEST", message: "The currency request is invalid." } }, { status: 400 }); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_CURRENCY_REQUEST", message: "The currency request is invalid." } }, { status: 400 });
  try {
    const persistence = getPersistenceContext();
    return NextResponse.json(await deactivateCurrency((await context.params).businessId as BusinessId, parsed.data.currencyId, actor, {
      tenancyRepository: persistence.tenancyRepository,
      currencies: persistence.currencyRepository,
    }));
  } catch (error) { return responseFor(error); }
}
