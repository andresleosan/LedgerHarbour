import { DocumentProcessorServiceClient } from "@google-cloud/documentai";

import {
  GoogleDocumentAiInvoiceProvider,
  type GoogleDocumentAiClient,
} from "./google-document-ai-provider";
import { FakeOcrProvider } from "./fake-ocr-provider";
import type { OcrProvider } from "./ocr-provider";

const INVALID_CONFIGURATION_MESSAGE = "OCR provider configuration is invalid.";

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

function createGoogleProvider(env: NodeJS.ProcessEnv): OcrProvider {
  const projectId = requiredValue(env, "GOOGLE_CLOUD_PROJECT_ID");
  const location = requiredValue(env, "GOOGLE_CLOUD_LOCATION");
  const processorId = requiredValue(env, "GOOGLE_DOCUMENT_AI_PROCESSOR_ID");
  const serviceAccountJson = requiredValue(env, "GOOGLE_SERVICE_ACCOUNT_JSON");

  if (!projectId || !location || !processorId || !serviceAccountJson) {
    throw new OcrConfigurationError();
  }

  try {
    const parsedCredentials: unknown = JSON.parse(serviceAccountJson);
    if (
      parsedCredentials === null ||
      typeof parsedCredentials !== "object" ||
      Array.isArray(parsedCredentials)
    ) {
      throw new Error("invalid credentials shape");
    }

    const sdkClient = new DocumentProcessorServiceClient({
      apiEndpoint: `${location}-documentai.googleapis.com`,
      credentials: parsedCredentials as { client_email?: string; private_key?: string },
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

  if (provider === "fake") return new FakeOcrProvider();
  if (provider === "google-document-ai") return createGoogleProvider(env);

  throw new OcrConfigurationError();
}
