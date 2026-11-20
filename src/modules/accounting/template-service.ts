import { createHash, randomUUID } from "node:crypto";

import type { StorageAdapter } from "../documents/storage-adapter";
import { resolveDefaultStorage } from "../invoices/invoice-service";
import { readTemplate } from "../workbook/read-template";
import { TEMPLATE_MAX_BYTES, TemplateReadError, type AccountSheet, type TemplateDefect, type TemplateProfile } from "../workbook/template-profile";
import { defaultOnboardingRepository, resolveOnboardingActor, type OnboardingActor, type OnboardingRepository } from "../tenancy/business-service";
import type { BusinessId, UserId } from "../tenancy/types";
import {
  HeadingError,
  applyHeadingImport,
  requireHeadingCapability,
  resolveDefaultHeadingRepository,
  validateHeadingImport,
  type HeadingRepository,
} from "./heading-service";

/** Route and service limit for an uploaded template. */
export const TEMPLATE_MAX_SIZE_BYTES = TEMPLATE_MAX_BYTES;
export const TEMPLATE_MAX_FILE_NAME_LENGTH = 255;
const XLSX_MIME_TYPES = new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"]);
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export const TEMPLATE_ERROR_CODES = {
  INVALID_TEMPLATE_FILE: "INVALID_TEMPLATE_FILE",
  EMPTY_TEMPLATE: "EMPTY_TEMPLATE",
  TEMPLATE_TOO_LARGE: "TEMPLATE_TOO_LARGE",
  UNSUPPORTED_TEMPLATE_TYPE: "UNSUPPORTED_TEMPLATE_TYPE",
  TEMPLATE_UNREADABLE: "TEMPLATE_UNREADABLE",
  BUSINESS_ACCESS_DENIED: "BUSINESS_ACCESS_DENIED",
  INACTIVE_BUSINESS: "INACTIVE_BUSINESS",
  INSUFFICIENT_CAPABILITY: "INSUFFICIENT_CAPABILITY",
  TEMPLATE_STORAGE_FAILURE: "TEMPLATE_STORAGE_FAILURE",
  TEMPLATE_REPOSITORY_CONFLICT: "TEMPLATE_REPOSITORY_CONFLICT",
} as const;

export type TemplateErrorCode = (typeof TEMPLATE_ERROR_CODES)[keyof typeof TEMPLATE_ERROR_CODES];

const messages: Record<TemplateErrorCode, string> = {
  INVALID_TEMPLATE_FILE: "The template file is invalid.",
  EMPTY_TEMPLATE: "The template file is empty.",
  TEMPLATE_TOO_LARGE: "The template exceeds the 10 MiB limit.",
  UNSUPPORTED_TEMPLATE_TYPE: "The template must be an .xlsx workbook.",
  TEMPLATE_UNREADABLE: "The template could not be read.",
  BUSINESS_ACCESS_DENIED: "Business access denied.",
  INACTIVE_BUSINESS: "This business is inactive.",
  INSUFFICIENT_CAPABILITY: "You do not have permission to manage the template.",
  TEMPLATE_STORAGE_FAILURE: "The template could not be stored.",
  TEMPLATE_REPOSITORY_CONFLICT: "The template changed elsewhere.",
};

export class TemplateError extends Error {
  readonly name = "TemplateError";

  /** `readerCode` carries the template reader's code for TEMPLATE_UNREADABLE. */
  constructor(readonly code: TemplateErrorCode, readonly readerCode?: string) {
    super(messages[code]);
  }
}

export interface StoredTemplateProfile {
  sheets: AccountSheet[];
  defects: TemplateDefect[];
}

export interface BusinessTemplate {
  id: string;
  businessId: BusinessId;
  privateObjectKey: string;
  originalFileName: string;
  sizeBytes: number;
  checksum: string;
  profile: StoredTemplateProfile;
  uploadedBy: UserId;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateRepository {
  transaction<T>(operation: () => Promise<T>): Promise<T>;
  findByBusinessId(businessId: BusinessId): Promise<BusinessTemplate | null>;
  /** Inserts or replaces the business's single current template; an existing row keeps its id. */
  upsert(template: BusinessTemplate): Promise<BusinessTemplate>;
}

export interface InMemoryTemplateRepository extends TemplateRepository {
  readonly templates: Map<BusinessId, BusinessTemplate>;
}

const clone = (template: BusinessTemplate): BusinessTemplate => structuredClone(template);

class MemoryTemplateRepository implements InMemoryTemplateRepository {
  readonly templates = new Map<BusinessId, BusinessTemplate>();
  private tail: Promise<void> = Promise.resolve();

  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise((resolve) => { release = resolve; });
    await previous;
    const snapshot = new Map([...this.templates].map(([id, template]) => [id, clone(template)]));
    try {
      return await operation();
    } catch (error) {
      this.templates.clear();
      snapshot.forEach((template, id) => this.templates.set(id, template));
      throw error;
    } finally {
      release();
    }
  }

  async findByBusinessId(businessId: BusinessId): Promise<BusinessTemplate | null> {
    const template = this.templates.get(businessId);
    return template ? clone(template) : null;
  }

  async upsert(template: BusinessTemplate): Promise<BusinessTemplate> {
    const existing = this.templates.get(template.businessId);
    const saved = existing ? { ...template, id: existing.id, createdAt: existing.createdAt } : template;
    this.templates.set(template.businessId, clone(saved));
    return clone(saved);
  }
}

export function createTemplateRepository(): InMemoryTemplateRepository {
  return new MemoryTemplateRepository();
}

const TEMPLATE_REPOSITORY_KEY = Symbol.for("ledgerharbour.lh014.templateRepository");
type GlobalState = typeof globalThis & { [key: symbol]: unknown };

export function resolveDefaultTemplateRepository(): TemplateRepository {
  const state = globalThis as GlobalState;
  const existing = state[TEMPLATE_REPOSITORY_KEY] as TemplateRepository | undefined;
  if (existing && typeof existing.findByBusinessId === "function" && typeof existing.upsert === "function") return existing;
  const repository = createTemplateRepository();
  Object.defineProperty(state, TEMPLATE_REPOSITORY_KEY, { configurable: false, enumerable: false, writable: false, value: repository });
  return repository;
}

export interface TemplateDependencies {
  tenancyRepository?: OnboardingRepository;
  headings?: HeadingRepository;
  templates?: TemplateRepository;
  storage?: StorageAdapter;
}

export interface TemplateFileInput {
  name: string;
  mimeType: string;
  data: Uint8Array;
}

export interface TemplateImportResult {
  inserted: number;
  updated: number;
  unchanged: number;
  missing: number;
  sheets: AccountSheet[];
  defects: TemplateDefect[];
}

export interface TemplateSummary {
  fileName: string;
  uploadedAt: string;
  sheets: AccountSheet[];
  defects: TemplateDefect[];
}

function mapBoundaryError(error: unknown): TemplateError {
  if (error instanceof TemplateError) return error;
  if (error instanceof HeadingError && error.code in TEMPLATE_ERROR_CODES) return new TemplateError(error.code as TemplateErrorCode);
  return new TemplateError(TEMPLATE_ERROR_CODES.TEMPLATE_REPOSITORY_CONFLICT);
}

async function authorize(businessId: unknown, actorId: UserId, tenancy: OnboardingRepository, capability: "read_finance" | "edit_finance"): Promise<BusinessId> {
  if (typeof businessId !== "string" || !businessId.trim()) throw new TemplateError(TEMPLATE_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  try {
    await requireHeadingCapability(businessId as BusinessId, actorId, tenancy, capability);
  } catch (error) {
    throw mapBoundaryError(error);
  }
  return businessId as BusinessId;
}

function validateFile(file: TemplateFileInput): void {
  if (!file || typeof file.name !== "string" || typeof file.mimeType !== "string" || !(file.data instanceof Uint8Array)) throw new TemplateError(TEMPLATE_ERROR_CODES.INVALID_TEMPLATE_FILE);
  if (!file.name.trim() || [...file.name].length > TEMPLATE_MAX_FILE_NAME_LENGTH) throw new TemplateError(TEMPLATE_ERROR_CODES.INVALID_TEMPLATE_FILE);
  if (!file.name.toLowerCase().endsWith(".xlsx") || !XLSX_MIME_TYPES.has(file.mimeType.toLowerCase())) throw new TemplateError(TEMPLATE_ERROR_CODES.UNSUPPORTED_TEMPLATE_TYPE);
  if (file.data.byteLength === 0) throw new TemplateError(TEMPLATE_ERROR_CODES.EMPTY_TEMPLATE);
  if (file.data.byteLength > TEMPLATE_MAX_SIZE_BYTES) throw new TemplateError(TEMPLATE_ERROR_CODES.TEMPLATE_TOO_LARGE);
  if (!ZIP_MAGIC.every((byte, index) => file.data[index] === byte)) throw new TemplateError(TEMPLATE_ERROR_CODES.UNSUPPORTED_TEMPLATE_TYPE);
}

async function read(data: Uint8Array): Promise<TemplateProfile> {
  try {
    return await readTemplate(data);
  } catch (error) {
    if (error instanceof TemplateReadError) throw new TemplateError(TEMPLATE_ERROR_CODES.TEMPLATE_UNREADABLE, error.code);
    throw new TemplateError(TEMPLATE_ERROR_CODES.TEMPLATE_UNREADABLE, "NOT_A_WORKBOOK");
  }
}

function defectCounts(defects: TemplateDefect[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const defect of defects) counts[defect.code] = (counts[defect.code] ?? 0) + 1;
  return counts;
}

export async function importTemplate(businessId: BusinessId, file: TemplateFileInput, actor: OnboardingActor, dependencies: TemplateDependencies = {}): Promise<TemplateImportResult> {
  const tenancy = dependencies.tenancyRepository ?? defaultOnboardingRepository;
  const headings = dependencies.headings ?? resolveDefaultHeadingRepository();
  const templates = dependencies.templates ?? resolveDefaultTemplateRepository();
  const storage = dependencies.storage ?? resolveDefaultStorage();
  const actorId = await resolveOnboardingActor(tenancy, actor);
  await authorize(businessId, actorId, tenancy, "edit_finance");

  validateFile(file);
  const profile = await read(file.data);
  let incoming;
  try {
    incoming = validateHeadingImport(profile.headings);
  } catch {
    throw new TemplateError(TEMPLATE_ERROR_CODES.TEMPLATE_UNREADABLE, "INVALID_HEADINGS");
  }

  const objectKey = `business/${businessId}/template/${randomUUID()}`;
  try {
    await storage.put({ objectKey, data: file.data });
  } catch {
    throw new TemplateError(TEMPLATE_ERROR_CODES.TEMPLATE_STORAGE_FAILURE);
  }

  const now = new Date().toISOString();
  let previousKey: string | undefined;
  let counts: { inserted: number; updated: number; unchanged: number; missing: number };
  try {
    counts = await headings.transaction(() => templates.transaction(async () => {
      previousKey = (await templates.findByBusinessId(businessId))?.privateObjectKey;
      const applied = await applyHeadingImport(headings, businessId, incoming, now);
      const saved = await templates.upsert({
        id: randomUUID(),
        businessId,
        privateObjectKey: objectKey,
        originalFileName: file.name,
        sizeBytes: file.data.byteLength,
        checksum: createHash("sha256").update(file.data).digest("hex"),
        profile: { sheets: profile.sheets, defects: profile.defects },
        uploadedBy: actorId,
        createdAt: now,
        updatedAt: now,
      });
      await tenancy.transaction((transaction) => transaction.appendAuditEvent({
        businessId,
        actorId,
        type: "account_template_imported",
        entityId: saved.id,
        metadata: { ...applied, defects: defectCounts(profile.defects), sheets: profile.sheets.length },
      }));
      return applied;
    }));
  } catch (error) {
    try { await storage.delete?.(objectKey); } catch { /* cleanup is best effort; the public error stays stable */ }
    throw mapBoundaryError(error);
  }

  if (previousKey && previousKey !== objectKey) {
    try { await storage.delete?.(previousKey); } catch { /* the new template is already current */ }
  }
  return { ...counts, sheets: profile.sheets, defects: profile.defects };
}

export async function getTemplate(businessId: BusinessId, actor: OnboardingActor, dependencies: TemplateDependencies = {}): Promise<TemplateSummary | null> {
  const tenancy = dependencies.tenancyRepository ?? defaultOnboardingRepository;
  const templates = dependencies.templates ?? resolveDefaultTemplateRepository();
  const actorId = await resolveOnboardingActor(tenancy, actor);
  const id = await authorize(businessId, actorId, tenancy, "read_finance");
  try {
    const template = await templates.findByBusinessId(id);
    return template ? { fileName: template.originalFileName, uploadedAt: template.updatedAt, sheets: template.profile.sheets, defects: template.profile.defects } : null;
  } catch (error) {
    throw mapBoundaryError(error);
  }
}

/** The business's current template row and its file from private storage; null before any upload. */
export async function getTemplateFile(businessId: BusinessId, actor: OnboardingActor, dependencies: TemplateDependencies = {}): Promise<{ template: BusinessTemplate; data: Uint8Array } | null> {
  const tenancy = dependencies.tenancyRepository ?? defaultOnboardingRepository;
  const templates = dependencies.templates ?? resolveDefaultTemplateRepository();
  const storage = dependencies.storage ?? resolveDefaultStorage();
  const actorId = await resolveOnboardingActor(tenancy, actor);
  const id = await authorize(businessId, actorId, tenancy, "read_finance");
  let template: BusinessTemplate | null;
  try {
    template = await templates.findByBusinessId(id);
  } catch (error) {
    throw mapBoundaryError(error);
  }
  if (!template) return null;
  try {
    return { template, data: new Uint8Array(await new Response(await storage.get(template.privateObjectKey)).arrayBuffer()) };
  } catch {
    throw new TemplateError(TEMPLATE_ERROR_CODES.TEMPLATE_STORAGE_FAILURE);
  }
}
