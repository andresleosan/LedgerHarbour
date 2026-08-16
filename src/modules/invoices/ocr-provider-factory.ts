import { DocumentProcessorServiceClient } from "@google-cloud/documentai";

import {
  GoogleDocumentAiInvoiceProvider,
  type GoogleDocumentAiClient,
} from "./google-document-ai-provider";
import { FakeOcrProvider } from "./fake-ocr-provider";
import type { OcrProvider } from "./ocr-provider";

const INVALID_CONFIGURATION_MESSAGE = "OCR provider configuration is invalid.";
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export class OcrConfigurationError extends Error {
  readonly name = "OcrConfigurationError";

  constructor() {
    super(INVALID_CONFIGURATION_MESSAGE);
  }
}

function requiredValue(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isValidProjectId(value: string): boolean {
  return PROJECT_ID_PATTERN.test(value) && !CONTROL_CHARACTER_PATTERN.test(value);
}

function isValidProcessorId(value: string): boolean {
  return value.length > 0 && !CONTROL_CHARACTER_PATTERN.test(value) && !/[\\/]/.test(value);
}

function parseServiceAccountJson(
  value: string,
): { client_email: string; private_key: string } & Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    const credentials = parsed as Record<string, unknown>;
    if (
      typeof credentials.client_email !== "string" ||
      credentials.client_email.trim().length === 0 ||
      typeof credentials.private_key !== "string" ||
      credentials.private_key.trim().length === 0
    ) {
      return null;
    }

    return credentials as { client_email: string; private_key: string } & Record<string, unknown>;
  } catch {
    return null;
  }
}

function createGoogleProvider(env: NodeJS.ProcessEnv): OcrProvider {
  const projectId = requiredValue(env, "GOOGLE_CLOUD_PROJECT_ID");
  const location = requiredValue(env, "GOOGLE_CLOUD_LOCATION");
  const processorId = requiredValue(env, "GOOGLE_DOCUMENT_AI_PROCESSOR_ID");
  const serviceAccountJson = requiredValue(env, "GOOGLE_SERVICE_ACCOUNT_JSON");

  if (
    !projectId ||
    !isValidProjectId(projectId) ||
    !location ||
    !["us", "eu"].includes(location) ||
    !processorId ||
    !isValidProcessorId(processorId) ||
    !serviceAccountJson
  ) {
    throw new OcrConfigurationError();
  }

  const parsedCredentials = parseServiceAccountJson(serviceAccountJson);
  if (!parsedCredentials) throw new OcrConfigurationError();

  try {
    const sdkClient = new DocumentProcessorServiceClient({
      apiEndpoint: `${location}-documentai.googleapis.com`,
      credentials: parsedCredentials,
    });

    const client: GoogleDocumentAiClient = {
      processDocument: async (request) => {
        const [response] = await sdkClient.processDocument(request);
        return {
          entities: (response.document?.entities ?? []).map((entity) => ({
            type: entity.type,
            mentionText: entity.mentionText,
            confidence: entity.confidence,
            normalizedValue: entity.normalizedValue
              ? {
                  dateValue: entity.normalizedValue.dateValue
                    ? {
                        year: entity.normalizedValue.dateValue.year,
                        month: entity.normalizedValue.dateValue.month,
                        day: entity.normalizedValue.dateValue.day,
                      }
                    : null,
                  moneyValue: entity.normalizedValue.moneyValue
                    ? {
                        units:
                          entity.normalizedValue.moneyValue.units === null ||
                          entity.normalizedValue.moneyValue.units === undefined
                            ? null
                            : String(entity.normalizedValue.moneyValue.units),
                        nanos:
                          entity.normalizedValue.moneyValue.nanos === null ||
                          entity.normalizedValue.moneyValue.nanos === undefined
                            ? null
                            : String(entity.normalizedValue.moneyValue.nanos),
                        currencyCode: entity.normalizedValue.moneyValue.currencyCode,
                      }
                    : null,
                }
              : null,
          })),
        };
      },
    };

    return new GoogleDocumentAiInvoiceProvider({
      client,
      processorName: `projects/${projectId}/locations/${location}/processors/${processorId}`,
    });
  } catch {
    throw new OcrConfigurationError();
  }
}

export function createOcrProvider(env: NodeJS.ProcessEnv = process.env): OcrProvider {
  const provider = env.OCR_PROVIDER;

  if (provider === "fake") {
    if (env.NODE_ENV?.trim() === "production") throw new OcrConfigurationError();
    return new FakeOcrProvider();
  }
  if (provider === "google-document-ai") return createGoogleProvider(env);

  throw new OcrConfigurationError();
}
