import { randomUUID } from "node:crypto";

import {
  defaultOnboardingRepository,
  resolveOnboardingActor,
  type OnboardingActor,
  type OnboardingRepository,
} from "../tenancy/business-service";
import { BusinessLifecycleError, LIFECYCLE_ERROR_CODES, requireBusinessOperational } from "../tenancy/business-lifecycle-service";
import { AUTHORIZATION_ERROR_CODES, AuthorizationError } from "../permissions/authorize";
import { createTenantContext } from "../tenancy/tenant-context";
import type { BusinessId, UserId } from "../tenancy/types";
import { createStorageAdapter } from "./storage-factory";
import type { StorageAdapter } from "./storage-adapter";
import type { ValidatedUpload } from "./file-validation";
import type { JobRepository } from "../jobs/job-service";
import type { DocumentId } from "../invoices/ocr-provider";

export const DOCUMENT_ERROR_CODES = {
  INACTIVE_BUSINESS: "INACTIVE_BUSINESS",
  BUSINESS_NOT_FOUND: "BUSINESS_NOT_FOUND",
  BUSINESS_ACCESS_DENIED: "BUSINESS_ACCESS_DENIED",
  DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
  DUPLICATE_CHECKSUM: "DOCUMENT_DUPLICATE_CHECKSUM",
  STORAGE_FAILURE: "DOCUMENT_STORAGE_FAILURE",
} as const;

export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[keyof typeof DOCUMENT_ERROR_CODES];

const publicMessages: Record<DocumentErrorCode, string> = {
  INACTIVE_BUSINESS: "This business is inactive.",
  BUSINESS_NOT_FOUND: "Business not found.",
  BUSINESS_ACCESS_DENIED: "Business access denied.",
  DOCUMENT_NOT_FOUND: "Document not found.",
  DOCUMENT_DUPLICATE_CHECKSUM: "This document has already been uploaded.",
  DOCUMENT_STORAGE_FAILURE: "The document could not be stored.",
};

export class DocumentError extends Error {
  readonly name = "DocumentError";

  constructor(readonly code: DocumentErrorCode) {
    super(publicMessages[code]);
  }
}

/**
 * In development every route bundle has its own copy of this module while the in-memory
 * repository is shared through globalThis, so its errors can fail `instanceof DocumentError`.
 */
export function asDocumentError(error: unknown): DocumentError | null {
  if (error instanceof DocumentError) return error;
  const candidate = error as { name?: unknown; code?: unknown } | null;
  if (candidate?.name === "DocumentError" && typeof candidate.code === "string" && Object.hasOwn(publicMessages, candidate.code)) {
    return new DocumentError(candidate.code as DocumentErrorCode);
  }
  return null;
}

export interface Document {
  id: string;
  businessId: BusinessId;
  uploaderId: UserId;
  privateObjectKey: string;
  originalFileName: string;
  originalMimeType: string;
  originalSizeBytes: number;
  checksum: string;
  status: "uploaded" | "processing" | "needs_review" | "approved" | "failed";
  createdAt: string;
}

export interface SafeDocumentDto extends Omit<Document, "privateObjectKey"> {}

export interface CreateDocumentInput {
  businessId: BusinessId;
  upload: ValidatedUpload;
}

export type ReplacementUpload = Pick<Document, "privateObjectKey" | "originalFileName" | "originalMimeType" | "originalSizeBytes">;

export interface DocumentRepository {
  transaction<T>(operation: () => Promise<T>): Promise<T>;
  create(document: Document): Promise<Document>;
  findByChecksum?(businessId: BusinessId, checksum: string): Promise<Document | null>;
  /** Points a failed document at a new upload and resets it to "uploaded"; null when it is no longer failed. */
  replaceFailedUpload?(documentId: string, replacement: ReplacementUpload): Promise<Document | null>;
  findById(documentId: string): Promise<Document | null>;
  getStatus(documentId: string): Promise<Document["status"] | null>;
  setStatus(documentId: string, status: Document["status"]): Promise<Document | null>;
  listByBusinessId(businessId: BusinessId): Promise<Document[]>;
}

export interface InMemoryDocumentRepository extends DocumentRepository {
  readonly documents: Map<string, Document>;
  failNextCreate: boolean;
}

class MemoryDocumentRepository implements InMemoryDocumentRepository {
  readonly documents = new Map<string, Document>();
  failNextCreate = false;
  private writeTail: Promise<void> = Promise.resolve();


  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeTail;
    let release!: () => void;
    this.writeTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async create(document: Document): Promise<Document> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error("development document repository failure");
    }
    if (this.documents.has(document.id)) throw new Error("document conflict");
    if ([...this.documents.values()].some((candidate) =>
      candidate.businessId === document.businessId && candidate.checksum === document.checksum,
    )) throw new DocumentError(DOCUMENT_ERROR_CODES.DUPLICATE_CHECKSUM);
    this.documents.set(document.id, { ...document });
    return { ...document };
  }

  async findById(documentId: string): Promise<Document | null> {
    const document = this.documents.get(documentId);
    return document ? { ...document } : null;
  }

  async findByChecksum(businessId: BusinessId, checksum: string): Promise<Document | null> {
    const document = [...this.documents.values()].find((candidate) => candidate.businessId === businessId && candidate.checksum === checksum);
    return document ? { ...document } : null;
  }

  async replaceFailedUpload(documentId: string, replacement: ReplacementUpload): Promise<Document | null> {
    const document = this.documents.get(documentId);
    if (document?.status !== "failed") return null;
    const updated = { ...document, ...replacement, status: "uploaded" as const };
    this.documents.set(documentId, updated);
    return { ...updated };
  }

  async getStatus(documentId: string): Promise<Document["status"] | null> {
    return (await this.findById(documentId))?.status ?? null;
  }

  async setStatus(documentId: string, status: Document["status"]): Promise<Document | null> {
    const document = this.documents.get(documentId);
    if (!document) return null;
    const updated = { ...document, status };
    this.documents.set(documentId, updated);
    return { ...updated };
  }

  async listByBusinessId(businessId: BusinessId): Promise<Document[]> {
    return [...this.documents!.values()]
      .filter((document) => document.businessId === businessId)
      .map((document) => ({ ...document }));
  }
}

export function createDocumentRepository(): InMemoryDocumentRepository {
  return new MemoryDocumentRepository();
}

const DOCUMENT_REPOSITORY_KEY = Symbol.for("ledgerharbour.task7.inMemoryDocumentRepository");
const DOCUMENT_STORAGE_KEY = Symbol.for("ledgerharbour.task7.localPrivateStorage");
type GlobalState = typeof globalThis & { [key: symbol]: unknown };

function isDocumentRepository(value: unknown): value is DocumentRepository {
  const candidate = value as Partial<DocumentRepository>;
  return Boolean(candidate && typeof candidate.create === "function" && typeof candidate.findById === "function" && typeof candidate.getStatus === "function" && typeof candidate.setStatus === "function" && typeof candidate.listByBusinessId === "function");
}

function defaultDocumentRepository(): DocumentRepository {
  const state = globalThis as GlobalState;
  if (isDocumentRepository(state[DOCUMENT_REPOSITORY_KEY])) return state[DOCUMENT_REPOSITORY_KEY];
   const repository = createDocumentRepository();
  Object.defineProperty(state, DOCUMENT_REPOSITORY_KEY, { configurable: false, enumerable: false, writable: false, value: repository });
  return repository;
}

function isStorageAdapter(value: unknown): value is StorageAdapter {
  const candidate = value as Partial<StorageAdapter>;
  return Boolean(candidate && typeof candidate.put === "function" && typeof candidate.get === "function");
}

function defaultStorage(): StorageAdapter {
  const state = globalThis as GlobalState;
  const existing = state[DOCUMENT_STORAGE_KEY];
  if (isStorageAdapter(existing)) return existing;
  const storage = createStorageAdapter();
  Object.defineProperty(state, DOCUMENT_STORAGE_KEY, { configurable: false, enumerable: false, writable: false, value: storage });
  return storage;
}

export interface DocumentDependencies {
  tenancyRepository?: OnboardingRepository;
  documentRepository?: DocumentRepository;
  storage?: StorageAdapter;
  jobs?: JobRepository;
}

export function mapBoundaryError(error: unknown): DocumentError {
  if (error instanceof BusinessLifecycleError) {
    if (error.code === LIFECYCLE_ERROR_CODES.INACTIVE_BUSINESS) return new DocumentError(DOCUMENT_ERROR_CODES.INACTIVE_BUSINESS);
    if (error.code === LIFECYCLE_ERROR_CODES.BUSINESS_NOT_FOUND) return new DocumentError(DOCUMENT_ERROR_CODES.BUSINESS_NOT_FOUND);
  }
  if (error instanceof AuthorizationError) return new DocumentError(DOCUMENT_ERROR_CODES.BUSINESS_ACCESS_DENIED);
  return new DocumentError(DOCUMENT_ERROR_CODES.STORAGE_FAILURE);
}

async function requireActiveMembership(
  tenancyRepository: OnboardingRepository,
  actorId: UserId,
  businessId: BusinessId,
): Promise<void> {
  const membership = await createTenantContext(tenancyRepository).getMembership(actorId, businessId);
  if (membership?.status !== "active" || !membership.isActive) {
    throw new AuthorizationError(AUTHORIZATION_ERROR_CODES.BUSINESS_ACCESS_DENIED, "Business access denied");
  }
}

export function toSafeDocument(document: Document): SafeDocumentDto {
  const safe = { ...document };
  Reflect.deleteProperty(safe, "privateObjectKey");
  return safe as SafeDocumentDto;
}

function objectKeyFor(businessId: BusinessId, documentId: string): string {
  return `business/${businessId}/documents/${documentId}-${randomUUID()}`;
}

export async function createDocument(
  input: CreateDocumentInput,
  actor: OnboardingActor,
  dependencies: DocumentDependencies = {},
): Promise<Document> {
  const tenancyRepository = dependencies.tenancyRepository ?? defaultOnboardingRepository;
  const repository = dependencies.documentRepository ?? defaultDocumentRepository();
  const storage = dependencies.storage ?? defaultStorage();
  const actorId = await resolveOnboardingActor(tenancyRepository, actor);

  let business;
  try {
    await requireActiveMembership(tenancyRepository, actorId, input.businessId);
    business = await requireBusinessOperational(tenancyRepository, input.businessId);
  } catch (error) {
    throw mapBoundaryError(error);
  }

  let storedObjectKey: string | undefined;
  let replacedObjectKey: string | undefined;
  try {
    const saved = await repository.transaction(async () => {
      const failed = await failedDocumentWithChecksum(repository, business.id, input.upload.checksum);
      const documentId = failed?.id ?? randomUUID();
      const document: Document = {
        id: documentId,
        businessId: business.id,
        uploaderId: actorId,
        privateObjectKey: objectKeyFor(business.id, documentId),
        originalFileName: input.upload.originalFileName,
        originalMimeType: input.upload.originalMimeType,
        originalSizeBytes: input.upload.originalSizeBytes,
        checksum: input.upload.checksum,
        status: "uploaded",
        createdAt: new Date().toISOString(),
      };
      storedObjectKey = document.privateObjectKey;
      try {
        await storage.put({ objectKey: document.privateObjectKey, data: input.upload.data });
        if (!failed) return await repository.create(document);
        // The same file failed to be read before: give that document the new upload and a fresh reading.
        const replaced = await repository.replaceFailedUpload!(failed.id, {
          privateObjectKey: document.privateObjectKey,
          originalFileName: document.originalFileName,
          originalMimeType: document.originalMimeType,
          originalSizeBytes: document.originalSizeBytes,
        });
        if (!replaced) throw new DocumentError(DOCUMENT_ERROR_CODES.DUPLICATE_CHECKSUM);
        await resetReading(failed.id, actorId, dependencies.jobs);
        replacedObjectKey = failed.privateObjectKey;
        return replaced;
      } catch (error) {
        throw asDocumentError(error) ?? new DocumentError(DOCUMENT_ERROR_CODES.STORAGE_FAILURE);
      }
    });
    if (replacedObjectKey) {
      try { await storage.delete?.(replacedObjectKey); } catch { /* the old object is unreferenced; removal is best effort */ }
    }
    return saved;
  } catch (error) {
    if (storedObjectKey) {
      try { await storage.delete?.(storedObjectKey); } catch { /* cleanup is best effort; public error remains stable */ }
    }
    throw asDocumentError(error) ?? new DocumentError(DOCUMENT_ERROR_CODES.STORAGE_FAILURE);
  }
}

async function failedDocumentWithChecksum(repository: DocumentRepository, businessId: BusinessId, checksum: string): Promise<Document | null> {
  if (!checksum || !repository.findByChecksum || !repository.replaceFailedUpload) return null;
  const existing = await repository.findByChecksum(businessId, checksum);
  return existing?.status === "failed" ? existing : null;
}

async function resetReading(documentId: string, actorId: UserId, injectedJobs?: JobRepository): Promise<void> {
  // Loaded lazily: the jobs module depends on this one.
  const jobs = injectedJobs ?? (await import("../jobs/job-service")).resolveDefaultJobRepository();
  const job = await jobs.findByDocumentId(documentId as DocumentId);
  if (!job) return;
  await jobs.update({ ...job, status: "queued", retryCount: 0, errorSummary: null, requestedBy: actorId, updatedAt: new Date().toISOString() });
}

export async function getDocumentForDownload(
  documentId: string,
  actor: OnboardingActor,
  dependencies: DocumentDependencies = {},
): Promise<{ document: Document; stream: ReadableStream<Uint8Array> }> {
  const tenancyRepository = dependencies.tenancyRepository ?? defaultOnboardingRepository;
  const repository = dependencies.documentRepository ?? defaultDocumentRepository();
  const storage = dependencies.storage ?? defaultStorage();
  const actorId = await resolveOnboardingActor(tenancyRepository, actor);
  const document = await repository.findById(documentId);
  if (!document) throw new DocumentError(DOCUMENT_ERROR_CODES.DOCUMENT_NOT_FOUND);
  try {
    await requireActiveMembership(tenancyRepository, actorId, document.businessId);
    await requireBusinessOperational(tenancyRepository, document.businessId);
    return { document, stream: await storage.get(document.privateObjectKey) };
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw mapBoundaryError(error);
  }
}
