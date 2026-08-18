import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  assertProductionConfiguration,
  ProductionConfigurationError,
} from "../../../src/modules/config/production-gate";
import { createPlaywrightWebServerEnv } from "../../../playwright.config";

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
    FIREBASE_CLIENT_EMAIL: "firebase-adminsdk@ledgerharbour-prod.iam.gserviceaccount.com",
    FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
    NEXT_PUBLIC_FIREBASE_API_KEY: "test-public-api-key",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "ledgerharbour-prod.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "ledgerharbour-prod",
    NEXT_PUBLIC_FIREBASE_APP_ID: "1:1234567890:web:abcdef123456",
    R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
    R2_BUCKET_NAME: "ledgerharbour-prod",
    R2_ACCESS_KEY_ID: "r2-access-key",
    R2_SECRET_ACCESS_KEY: "r2-secret-key",
    UPSTASH_REDIS_REST_URL: "https://redis.example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "test-upstash-token",
    GOOGLE_CLOUD_PROJECT_ID: "ledgerharbour-prod",
    GOOGLE_CLOUD_LOCATION: "us",
    GOOGLE_DOCUMENT_AI_PROCESSOR_ID: "processor-id",
    GOOGLE_SERVICE_ACCOUNT_JSON: '{"type":"service_account","project_id":"ledgerharbour-prod","client_email":"ocr@ledgerharbour-prod.iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----\\n"}',
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
    ["DATABASE_URL", "postgresql://replace-with-database-url/ledgerharbour"],
    ["R2_ENDPOINT", "https://<account-id>.r2.cloudflarestorage.com"],
    ["UPSTASH_REDIS_REST_URL", "https://replace-with-upstash-endpoint.upstash.io"],
    ["R2_ACCESS_KEY_ID", "replace-with-r2-access-key"],
    ["GOOGLE_DOCUMENT_AI_PROCESSOR_ID", "replace-with-invoice-parser-id"],
  ])("rejects placeholders in %s", (name, value) => {
    const environment = validProductionEnvironment();
    environment[name] = value;

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
    expect(() => assertProductionConfiguration(environment)).not.toThrowError(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("rejects malformed Google service account JSON without exposing it", () => {
    const environment = validProductionEnvironment();
    const malformed = "google-service-account-secret";
    environment.GOOGLE_SERVICE_ACCOUNT_JSON = malformed;

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
    expect(() => assertProductionConfiguration(environment)).not.toThrowError(new RegExp(malformed));
  });

  it("rejects incomplete Google service account credentials", () => {
    const environment = validProductionEnvironment();
    environment.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ type: "service_account", project_id: "ledgerharbour-prod" });

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
  });

  it("rejects inconsistent Firebase and Google project configuration", () => {
    const environment = validProductionEnvironment();
    environment.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "other-project";

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
  });

  it.each([
    ["DATABASE_URL", "not-a-database-url"],
    ["R2_ENDPOINT", "http://account-id.r2.cloudflarestorage.com"],
    ["UPSTASH_REDIS_REST_URL", "not-a-redis-url"],
  ])("rejects invalid URL in %s", (name, value) => {
    const environment = validProductionEnvironment();
    environment[name] = value;

    expect(() => assertProductionConfiguration(environment)).toThrow("Production configuration is invalid.");
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
    expect(source).not.toContain("...process.env");
    expect(source).not.toContain("GOOGLE_SERVICE_ACCOUNT_JSON");
  });

  it("passes only the test whitelist to the web server", () => {
    const effective = createPlaywrightWebServerEnv({
      NODE_ENV: "test",
      PATH: "test-path",
      DATABASE_URL: "postgresql://secret.example/database",
      GOOGLE_SERVICE_ACCOUNT_JSON: "secret-json",
      R2_SECRET_ACCESS_KEY: "secret-r2",
      UPSTASH_REDIS_REST_TOKEN: "secret-upstash",
      FIREBASE_PRIVATE_KEY: "secret-firebase",
    });

    expect(effective).toMatchObject({ PATH: "test-path", NODE_ENV: "test", AUTH_MODE: "firebase", OCR_PROVIDER: "fake" });
    expect(effective).not.toHaveProperty("DATABASE_URL");
    expect(effective).not.toHaveProperty("GOOGLE_SERVICE_ACCOUNT_JSON");
    expect(effective).not.toHaveProperty("R2_SECRET_ACCESS_KEY");
    expect(effective).not.toHaveProperty("UPSTASH_REDIS_REST_TOKEN");
    expect(effective).not.toHaveProperty("FIREBASE_PRIVATE_KEY");
  });

  it("keeps CI on explicit test providers without development auth or secrets", () => {
    const source = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");

    expect(source).toContain("AUTH_MODE: firebase");
    expect(source).toContain("OCR_PROVIDER: fake");
    expect(source).toContain("PERSISTENCE_MODE: memory");
    expect(source).toContain("STORAGE_MODE: local");
    expect(source).toContain("RATE_LIMIT_MODE: memory");
    expect(source).not.toContain("AUTH_MODE: development");
    expect(source).not.toContain("DEV_SESSION_SECRET");
    expect(source).not.toContain("DATABASE_URL:");
    expect(source).not.toContain("GOOGLE_SERVICE_ACCOUNT_JSON:");
    expect(source).not.toContain("FIREBASE_PRIVATE_KEY:");
    expect(source).not.toContain("R2_SECRET_ACCESS_KEY:");
    expect(source).not.toContain("UPSTASH_REDIS_REST_TOKEN:");
  });
});
