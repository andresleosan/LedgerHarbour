import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertProductionConfiguration,
  ProductionConfigurationError,
} from "../../../src/modules/config/production-gate";

function validProductionEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    AUTH_MODE: "firebase",
    OCR_PROVIDER: "google-document-ai",
    PERSISTENCE_MODE: "postgres",
    STORAGE_MODE: "r2",
    RATE_LIMIT_MODE: "upstash",
    DATABASE_URL: "postgresql://runtime.example/ledgerharbour",
    FIREBASE_PROJECT_ID: "ledgerharbour-prod",
    FIREBASE_CLIENT_EMAIL: "firebase-adminsdk@example.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: "test-only-private-key",
    NEXT_PUBLIC_FIREBASE_API_KEY: "test-public-api-key",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "ledgerharbour-prod.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "ledgerharbour-prod",
    NEXT_PUBLIC_FIREBASE_APP_ID: "test-app-id",
    R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
    R2_BUCKET_NAME: "ledgerharbour-prod",
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
    UPSTASH_REDIS_REST_URL: "https://redis.example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "test-upstash-token",
    GOOGLE_CLOUD_PROJECT_ID: "ledgerharbour-prod",
    GOOGLE_CLOUD_LOCATION: "us",
    GOOGLE_DOCUMENT_AI_PROCESSOR_ID: "processor-id",
    GOOGLE_SERVICE_ACCOUNT_JSON: '{"client_email":"ocr@example.iam.gserviceaccount.com","private_key":"test-key"}',
  };
}

describe("production configuration gate", () => {
  it("accepts the complete production contract", () => {
    expect(() => assertProductionConfiguration(validProductionEnvironment())).not.toThrow();
  });

  it("fails closed with a generic error when a required value is missing", () => {
    const environment = validProductionEnvironment();
    delete environment.FIREBASE_PRIVATE_KEY;

    expect(() => assertProductionConfiguration(environment)).toThrow(ProductionConfigurationError);
    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
    expect(() => assertProductionConfiguration(environment)).not.toThrowError(/FIREBASE_PRIVATE_KEY|test-key/);
  });

  it.each([
    ["AUTH_MODE", "development"],
    ["OCR_PROVIDER", "fake"],
    ["PERSISTENCE_MODE", "memory"],
    ["STORAGE_MODE", "local"],
    ["RATE_LIMIT_MODE", "memory"],
  ])("rejects %s=%s in production", (name, value) => {
    const environment = validProductionEnvironment();
    environment[name] = value;

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
  });

  it("keeps the browser harness on explicit non-paid test providers", () => {
    const source = readFileSync(new URL("../../../playwright.config.ts", import.meta.url), "utf8");

    expect(source).toContain('AUTH_MODE: "firebase"');
    expect(source).toContain('OCR_PROVIDER: "fake"');
    expect(source).toContain('PERSISTENCE_MODE: "memory"');
    expect(source).toContain('STORAGE_MODE: "local"');
    expect(source).toContain('RATE_LIMIT_MODE: "memory"');
    expect(source).not.toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
  });
});
