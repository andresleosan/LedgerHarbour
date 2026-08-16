import type {
  OcrInput,
  OcrProvider,
  OcrResult,
} from "./ocr-provider";
import { OcrProviderError } from "./ocr-provider";

export interface GoogleDocumentAiRequest {
  name: string;
  rawDocument: {
    content: Buffer;
    mimeType: string;
  };
}

export interface GoogleDocumentAiEntity {
  type?: string | null;
  mentionText?: string | null;
  confidence?: number | null;
  normalizedValue?: {
    dateValue?: {
      year?: number | null;
      month?: number | null;
      day?: number | null;
    } | null;
    moneyValue?: {
      units?: string | number | bigint | null;
      nanos?: number | string | null;
      currencyCode?: string | null;
    } | null;
  } | null;
}

export interface GoogleDocumentAiResponse {
  entities?: readonly GoogleDocumentAiEntity[] | null;
}

export interface GoogleDocumentAiClient {
  processDocument(request: GoogleDocumentAiRequest): Promise<GoogleDocumentAiResponse>;
}

export interface GoogleDocumentAiProviderOptions {
  client: GoogleDocumentAiClient;
  processorName: string;
}

type MappedField =
  | "supplier"
  | "invoiceNumber"
  | "invoiceDate"
  | "dueDate"
  | "subtotal"
  | "taxAmount"
  | "total"
  | "currencyReference";

const ENTITY_TYPES: Record<MappedField, string> = {
  supplier: "supplier_name",
  invoiceNumber: "invoice_id",
  invoiceDate: "invoice_date",
  dueDate: "due_date",
  subtotal: "net_amount",
  taxAmount: "total_tax_amount",
  total: "total_amount",
  currencyReference: "currency",
};

const TRANSIENT_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_GRPC_CODES = new Set([4, 8, 10, 13, 14]);

function firstEntity(entities: readonly GoogleDocumentAiEntity[], type: string): GoogleDocumentAiEntity | null {
  return entities.find((entity) => entity.type === type) ?? null;
}

function confidence(entity: GoogleDocumentAiEntity | null): number {
  return entity?.confidence !== null && entity?.confidence !== undefined &&
    Number.isFinite(entity.confidence) && entity.confidence >= 0 && entity.confidence <= 1
    ? entity.confidence
    : 0;
}

function mentionText(entity: GoogleDocumentAiEntity | null): string | null {
  if (typeof entity?.mentionText !== "string" || entity.mentionText.length === 0) return null;
  return entity.mentionText;
}

function normalizedDate(entity: GoogleDocumentAiEntity | null): string | null {
  const date = entity?.normalizedValue?.dateValue;
  if (!date || !Number.isInteger(date.year) || !Number.isInteger(date.month) || !Number.isInteger(date.day)) {
    return null;
  }

  const year = date.year as number;
  const month = date.month as number;
  const day = date.day as number;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return null;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizedMoney(entity: GoogleDocumentAiEntity | null): string | null {
  const money = entity?.normalizedValue?.moneyValue;
  if (!money || money.units === null || money.units === undefined || money.nanos === null || money.nanos === undefined) {
    return null;
  }

  const units = String(money.units);
  const nanos = String(money.nanos);
  if (!/^\d+$/.test(units) || !/^\d+$/.test(nanos)) return null;

  const nanosNumber = Number(nanos);
  if (!Number.isSafeInteger(nanosNumber) || nanosNumber < 0 || nanosNumber > 999999999) return null;

  const normalizedUnits = units.replace(/^0+(?=\d)/, "");
  const fraction = nanos.padStart(9, "0").replace(/0+$/, "").padEnd(2, "0");
  return `${normalizedUnits}.${fraction}`;
}

function valueForEntity(
  entity: GoogleDocumentAiEntity | null,
  normalized: (entity: GoogleDocumentAiEntity | null) => string | null,
): string | null {
  return mentionText(entity) ?? normalized(entity);
}

function providerErrorIsRetryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const details = error as { status?: unknown; code?: unknown };
  const status = details.status ?? details.code;

  if (typeof status === "number") {
    return TRANSIENT_HTTP_STATUSES.has(status) || TRANSIENT_GRPC_CODES.has(status);
  }

  if (typeof status !== "string") return false;
  const normalizedStatus = status.toUpperCase();
  return TRANSIENT_HTTP_STATUSES.has(Number(status)) ||
    ["ABORTED", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED", "UNAVAILABLE"].includes(normalizedStatus);
}

function mapResponse(response: GoogleDocumentAiResponse): OcrResult {
  const entities = Array.isArray(response?.entities) ? response.entities : [];
  const entity = (field: MappedField) => firstEntity(entities, ENTITY_TYPES[field]);
  const supplier = entity("supplier");
  const invoiceNumber = entity("invoiceNumber");
  const invoiceDate = entity("invoiceDate");
  const dueDate = entity("dueDate");
  const subtotal = entity("subtotal");
  const taxAmount = entity("taxAmount");
  const total = entity("total");
  const currencyReference = entity("currencyReference");

  return {
    fields: {
      supplier: mentionText(supplier),
      invoiceNumber: mentionText(invoiceNumber),
      invoiceDate: valueForEntity(invoiceDate, normalizedDate),
      dueDate: valueForEntity(dueDate, normalizedDate),
      subtotal: valueForEntity(subtotal, normalizedMoney),
      taxAmount: valueForEntity(taxAmount, normalizedMoney),
      total: valueForEntity(total, normalizedMoney),
      currencyReference: mentionText(currencyReference),
      expenseCategoryReference: null,
      notes: null,
    },
    confidence: {
      supplier: confidence(supplier),
      invoiceNumber: confidence(invoiceNumber),
      invoiceDate: confidence(invoiceDate),
      dueDate: confidence(dueDate),
      subtotal: confidence(subtotal),
      taxAmount: confidence(taxAmount),
      total: confidence(total),
      currencyReference: confidence(currencyReference),
      expenseCategoryReference: 0,
      notes: 0,
    },
  };
}

export class GoogleDocumentAiInvoiceProvider implements OcrProvider {
  private readonly client: GoogleDocumentAiClient;
  private readonly processorName: string;

  constructor(options: GoogleDocumentAiProviderOptions) {
    this.client = options.client;
    this.processorName = options.processorName;
  }

  async extract(input: OcrInput): Promise<OcrResult> {
    try {
      const response = await this.client.processDocument({
        name: this.processorName,
        rawDocument: {
          content: Buffer.from(input.data),
          mimeType: input.mimeType,
        },
      });
      return mapResponse(response);
    } catch (error) {
      throw new OcrProviderError(providerErrorIsRetryable(error));
    }
  }
}
