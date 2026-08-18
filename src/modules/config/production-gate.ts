const PRODUCTION_CONFIGURATION_MESSAGE = "Production configuration is invalid.";

const requiredProductionValues = [
  "DATABASE_URL",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
  "R2_ENDPOINT",
  "R2_BUCKET_NAME",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "GOOGLE_CLOUD_PROJECT_ID",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_DOCUMENT_AI_PROCESSOR_ID",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
] as const;

const requiredProductionModes = {
  AUTH_MODE: "firebase",
  OCR_PROVIDER: "google-document-ai",
  PERSISTENCE_MODE: "postgres",
  STORAGE_MODE: "r2",
  RATE_LIMIT_MODE: "upstash",
} as const;

export class ProductionConfigurationError extends Error {
  readonly name = "ProductionConfigurationError";

  constructor() {
    super(PRODUCTION_CONFIGURATION_MESSAGE);
  }
}

function hasValue(environment: NodeJS.ProcessEnv, name: string): boolean {
  return typeof environment[name] === "string" && environment[name]!.trim().length > 0;
}

export function assertProductionConfiguration(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.NODE_ENV !== "production") return;

  const modesAreCorrect = Object.entries(requiredProductionModes).every(
    ([name, expected]) => environment[name] === expected,
  );
  const valuesArePresent = requiredProductionValues.every((name) => hasValue(environment, name));

  if (!modesAreCorrect || !valuesArePresent) throw new ProductionConfigurationError();
}
