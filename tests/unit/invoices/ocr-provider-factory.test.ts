import { describe, expect, it, vi } from "vitest";

const sdkMocks = vi.hoisted(() => ({
  constructorOptions: [] as unknown[],
  requests: [] as unknown[],
}));

vi.mock("@google-cloud/documentai", () => ({
  DocumentProcessorServiceClient: class {
    constructor(options: unknown) {
      sdkMocks.constructorOptions.push(options);
    }

    async processDocument(request: unknown) {
      sdkMocks.requests.push(request);
      return [{ document: { entities: [] } }];
    }
  },
}));

import { FakeOcrProvider } from "../../../src/modules/invoices/fake-ocr-provider";
import {
  createOcrProvider,
  OcrConfigurationError,
} from "../../../src/modules/invoices/ocr-provider-factory";
import { GoogleDocumentAiInvoiceProvider } from "../../../src/modules/invoices/google-document-ai-provider";

const serviceAccountJson = JSON.stringify({
  type: "service_account",
  project_id: "demo-project",
  private_key_id: "private-key-id",
  private_key: "-----BEGIN PRIVATE KEY-----\\nprivate-key\\n-----END PRIVATE KEY-----\\n",
  client_email: "document-ai@demo-project.iam.gserviceaccount.com",
});

const runtimeEnv = (values: Record<string, string>) => values as NodeJS.ProcessEnv;

const validGoogleEnv = (overrides: Record<string, string> = {}) =>
  runtimeEnv({
    OCR_PROVIDER: "google-document-ai",
    GOOGLE_CLOUD_PROJECT_ID: "demo-project",
    GOOGLE_CLOUD_LOCATION: "eu",
    GOOGLE_DOCUMENT_AI_PROCESSOR_ID: "invoice-processor",
    GOOGLE_SERVICE_ACCOUNT_JSON: serviceAccountJson,
    ...overrides,
  });

describe("OCR provider factory", () => {
  it("returns the fake provider when explicitly configured", () => {
    expect(
      createOcrProvider(runtimeEnv({ OCR_PROVIDER: "fake", NODE_ENV: "test" })),
    ).toBeInstanceOf(FakeOcrProvider);
  });

  it("rejects the fake provider in production", () => {
    expect(() =>
      createOcrProvider(runtimeEnv({ OCR_PROVIDER: "fake", NODE_ENV: "production" })),
    ).toThrowError(OcrConfigurationError);
  });

  it("rejects the fake provider outside the explicit test harness", () => {
    expect(() =>
      createOcrProvider(runtimeEnv({ OCR_PROVIDER: "fake", NODE_ENV: "development" })),
    ).toThrowError(OcrConfigurationError);
  });

  it("accepts the fake provider for the explicit Playwright test harness", () => {
    expect(
      createOcrProvider(runtimeEnv({
        OCR_PROVIDER: "fake",
        NODE_ENV: "development",
        LEDGERHARBOUR_TEST_MODE: "true",
      })),
    ).toBeInstanceOf(FakeOcrProvider);
  });

  it("rejects Google configuration when required values are missing", () => {
    expect(() => createOcrProvider(runtimeEnv({ OCR_PROVIDER: "google-document-ai" }))).toThrowError(
      OcrConfigurationError,
    );
  });

  it("rejects unsupported providers explicitly", () => {
    expect(() => createOcrProvider(runtimeEnv({ OCR_PROVIDER: "unsupported" }))).toThrowError(
      OcrConfigurationError,
    );
  });

  it("constructs Google Document AI with runtime credentials and the exact processor name", async () => {
    const provider = createOcrProvider(validGoogleEnv());

    expect(provider).toBeInstanceOf(GoogleDocumentAiInvoiceProvider);
    expect(sdkMocks.constructorOptions).toEqual([
      {
        apiEndpoint: "eu-documentai.googleapis.com",
        credentials: JSON.parse(serviceAccountJson),
      },
    ]);

    await provider.extract({
      documentId: "document-1",
      fileName: "invoice.pdf",
      mimeType: "application/pdf",
      data: new Uint8Array([1, 2, 3]),
    });
    expect(sdkMocks.requests).toEqual([
      {
        name: "projects/demo-project/locations/eu/processors/invoice-processor",
        rawDocument: {
          content: Buffer.from([1, 2, 3]),
          mimeType: "application/pdf",
        },
      },
    ]);
  });

  it("does not expose the service-account JSON when Google configuration is malformed", () => {
    const secret = "malformed-service-account-secret";

    expect(() =>
      createOcrProvider(runtimeEnv({
        OCR_PROVIDER: "google-document-ai",
        GOOGLE_CLOUD_PROJECT_ID: "demo-project",
        GOOGLE_CLOUD_LOCATION: "eu",
        GOOGLE_DOCUMENT_AI_PROCESSOR_ID: "invoice-processor",
        GOOGLE_SERVICE_ACCOUNT_JSON: secret,
      })),
    ).toThrowError(new OcrConfigurationError());

    try {
      createOcrProvider(runtimeEnv({
        OCR_PROVIDER: "google-document-ai",
        GOOGLE_CLOUD_PROJECT_ID: "demo-project",
        GOOGLE_CLOUD_LOCATION: "eu",
        GOOGLE_DOCUMENT_AI_PROCESSOR_ID: "invoice-processor",
        GOOGLE_SERVICE_ACCOUNT_JSON: secret,
      }));
    } catch (error) {
      expect(error).toBeInstanceOf(OcrConfigurationError);
      expect(error).not.toHaveProperty("cause");
      expect(String(error)).not.toContain(secret);
    }
  });

  it("rejects a service-account JSON object without required credentials", () => {
    expect(() =>
      createOcrProvider(validGoogleEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({}) })),
    ).toThrowError(OcrConfigurationError);
  });

  it("rejects project IDs containing a slash", () => {
    expect(() =>
      createOcrProvider(validGoogleEnv({ GOOGLE_CLOUD_PROJECT_ID: "demo/project" })),
    ).toThrowError(OcrConfigurationError);
  });

  it("rejects project IDs containing control characters", () => {
    expect(() =>
      createOcrProvider(validGoogleEnv({ GOOGLE_CLOUD_PROJECT_ID: "demo\u0000project" })),
    ).toThrowError(OcrConfigurationError);
  });

  it("rejects locations outside the supported regions", () => {
    expect(() =>
      createOcrProvider(validGoogleEnv({ GOOGLE_CLOUD_LOCATION: "asia" })),
    ).toThrowError(OcrConfigurationError);
  });

  it("rejects an empty processor ID", () => {
    expect(() =>
      createOcrProvider(validGoogleEnv({ GOOGLE_DOCUMENT_AI_PROCESSOR_ID: "" })),
    ).toThrowError(OcrConfigurationError);
  });

  it("rejects processor IDs containing a slash or control character", () => {
    expect(() =>
      createOcrProvider(validGoogleEnv({ GOOGLE_DOCUMENT_AI_PROCESSOR_ID: "invoice/processor" })),
    ).toThrowError(OcrConfigurationError);
    expect(() =>
      createOcrProvider(validGoogleEnv({ GOOGLE_DOCUMENT_AI_PROCESSOR_ID: "invoice\u0007processor" })),
    ).toThrowError(OcrConfigurationError);
  });
});
