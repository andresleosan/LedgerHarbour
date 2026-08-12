import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentIdentity } from "../../../../../modules/auth/session";
import { CategoryError, CATEGORY_ERROR_CODES, createCategory, listCategories, updateCategory } from "../../../../../modules/accounting/category-service";
import type { BusinessId } from "../../../../../modules/tenancy/types";

type RouteContext = { params: Promise<{ businessId: string }> };

const createSchema = z.object({ name: z.string() }).strict();
const updateSchema = z.object({ categoryId: z.string().min(1), name: z.string().optional(), isActive: z.boolean().optional() }).strict().refine((value) => value.name !== undefined || value.isActive !== undefined);

function responseFor(error: unknown): NextResponse {
  if (error instanceof CategoryError) {
    const status = error.code === CATEGORY_ERROR_CODES.CATEGORY_NOT_FOUND || error.code === CATEGORY_ERROR_CODES.BUSINESS_ACCESS_DENIED ? 404 :
      error.code === CATEGORY_ERROR_CODES.CATEGORY_NAME_CONFLICT ? 409 :
      error.code === CATEGORY_ERROR_CODES.INSUFFICIENT_CAPABILITY || error.code === CATEGORY_ERROR_CODES.INACTIVE_BUSINESS ? 403 :
      error.code === CATEGORY_ERROR_CODES.CATEGORY_REPOSITORY_CONFLICT ? 409 : 400;
    return NextResponse.json({ error: { code: error.code, message: error.message } }, { status });
  }
  return NextResponse.json({ error: { code: "CATEGORY_REQUEST_FAILED", message: "The category request could not be completed." } }, { status: 500 });
}

function identity() {
  return getCurrentIdentity();
}

export async function GET(_request: Request, context: RouteContext) {
   const actor = identity();
  if (!actor) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  try {
    return NextResponse.json(await listCategories((await context.params).businessId as BusinessId, actor));
  } catch (error) {
    return responseFor(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
   const actor = identity();
  if (!actor) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: { code: "INVALID_CATEGORY_REQUEST", message: "The category request is invalid." } }, { status: 400 }); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_CATEGORY_REQUEST", message: "The category request is invalid." } }, { status: 400 });
  try {
    return NextResponse.json(await createCategory({ businessId: (await context.params).businessId as BusinessId, name: parsed.data.name }, actor), { status: 201 });
  } catch (error) {
    return responseFor(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
   const actor = identity();
  if (!actor) return NextResponse.json({ error: { code: "IDENTITY_REQUIRED", message: "Sign in is required." } }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: { code: "INVALID_CATEGORY_REQUEST", message: "The category request is invalid." } }, { status: 400 }); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_CATEGORY_REQUEST", message: "The category request is invalid." } }, { status: 400 });
  try {
    return NextResponse.json(await updateCategory({ ...parsed.data, businessId: (await context.params).businessId as BusinessId }, actor));
  } catch (error) {
    return responseFor(error);
  }
}
