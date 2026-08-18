const PRODUCTION_CONFIGURATION_MESSAGE = "Production configuration is invalid.";
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const SERVICE_ACCOUNT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----/;
const APP_ID_PATTERN = /^1:\d+:web:[a-z0-9]+$/;
const PROCESSOR_ID_PATTERN = /^[a-zA-Z0-9-]{3,128}$/;
const BUCKET_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,61}[a-z0-9])?$/;
const R2_HOST_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.r2\.cloudflarestorage\.com$/;
const UPSTASH_HOST_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.upstash\.io$/;

const requiredProductionModes = {
  AUTH_MODE: "firebase",
  OCR_PROVIDER: "google-document-ai",
  PERSISTENCE_MODE: "postgres",
  STORAGE_MODE: "r2",
  RATE_LIMIT_MODE: "upstash",
} as const;

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

export type ProductionConfiguration = {
  readonly authMode: "firebase";
  readonly ocrProvider: "google-document-ai";
  readonly persistenceMode: "postgres";
  readonly storageMode: "r2";
  readonly rateLimitMode: "upstash";
};

export class ProductionConfigurationError extends Error {
  readonly name = "ProductionConfigurationError";

  constructor() {
    super(PRODUCTION_CONFIGURATION_MESSAGE);
  }
}

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.includes("replace-with") ||
    normalized.includes("replace_with") ||
    normalized.includes("changeme") ||
    normalized.includes("change-me") ||
    normalized.includes("placeholder") ||
    /(?:^|[-_.:/])(?:synthetic|dummy|sample|fake|example|test)(?:$|[-_.:/])/i.test(normalized) ||
    normalized.includes("<account-id>") ||
    normalized.includes("<your-") ||
    normalized.includes("your-secret");
}

function requiredValue(environment: NodeJS.ProcessEnv, name: string): string | null {
  const value = environment[name];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && !isPlaceholder(normalized) ? normalized : null;
}

function isValidProjectId(value: string | null): value is string {
  return value !== null && PROJECT_ID_PATTERN.test(value);
}

function isValidHttpsUrl(value: string | null, hostnameSuffix?: string): boolean {
  if (!value || isPlaceholder(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) &&
      (!hostnameSuffix || url.hostname.endsWith(hostnameSuffix));
  } catch {
    return false;
  }
}

function isValidDatabaseUrl(value: string | null): boolean {
  if (!value || isPlaceholder(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isValidR2Endpoint(value: string | null): boolean {
  if (!isValidHttpsUrl(value)) return false;
  try {
    return R2_HOST_PATTERN.test(new URL(value!).hostname);
  } catch {
    return false;
  }
}

function isValidUpstashEndpoint(value: string | null): boolean {
  if (!isValidHttpsUrl(value)) return false;
  try {
    return UPSTASH_HOST_PATTERN.test(new URL(value!).hostname);
  } catch {
    return false;
  }
}

function isValidPrivateKey(value: string | null): boolean {
  return value !== null && PRIVATE_KEY_PATTERN.test(value.replaceAll("\\n", "\n"));
}

function isValidServiceAccount(value: string | null, projectId: string): boolean {
  if (!value) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const credentials = parsed as Record<string, unknown>;
    return credentials.type === "service_account" &&
      credentials.project_id === projectId &&
      typeof credentials.client_email === "string" &&
      SERVICE_ACCOUNT_EMAIL_PATTERN.test(credentials.client_email) &&
      typeof credentials.private_key === "string" &&
      isValidPrivateKey(credentials.private_key);
  } catch {
    return false;
  }
}

function hasRequiredValues(environment: NodeJS.ProcessEnv): boolean {
  return requiredProductionValues.every((name) => requiredValue(environment, name) !== null);
}

export function parseProductionConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): ProductionConfiguration | null {
  if (environment.NODE_ENV !== "production") return null;
  if (!hasRequiredValues(environment)) return null;
  if (!Object.entries(requiredProductionModes).every(([name, expected]) => environment[name] === expected)) return null;

  const firebaseProjectId = requiredValue(environment, "FIREBASE_PROJECT_ID");
  const firebaseClientEmail = requiredValue(environment, "FIREBASE_CLIENT_EMAIL");
  const firebasePrivateKey = requiredValue(environment, "FIREBASE_PRIVATE_KEY");
  const publicApiKey = requiredValue(environment, "NEXT_PUBLIC_FIREBASE_API_KEY");
  const publicAuthDomain = requiredValue(environment, "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
  const publicProjectId = requiredValue(environment, "NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  const publicAppId = requiredValue(environment, "NEXT_PUBLIC_FIREBASE_APP_ID");
  const googleProjectId = requiredValue(environment, "GOOGLE_CLOUD_PROJECT_ID");
  const googleLocation = requiredValue(environment, "GOOGLE_CLOUD_LOCATION");
  const processorId = requiredValue(environment, "GOOGLE_DOCUMENT_AI_PROCESSOR_ID");
  const serviceAccount = requiredValue(environment, "GOOGLE_SERVICE_ACCOUNT_JSON");

  if (
    !isValidProjectId(firebaseProjectId) ||
    !isValidProjectId(publicProjectId) ||
    !isValidProjectId(googleProjectId) ||
    firebaseProjectId !== publicProjectId ||
    firebaseProjectId !== googleProjectId ||
    !firebaseClientEmail ||
    !SERVICE_ACCOUNT_EMAIL_PATTERN.test(firebaseClientEmail) ||
    !isValidPrivateKey(firebasePrivateKey) ||
    !publicApiKey ||
    publicAuthDomain !== `${firebaseProjectId}.firebaseapp.com` ||
    !publicAppId ||
    !APP_ID_PATTERN.test(publicAppId) ||
    !isValidDatabaseUrl(requiredValue(environment, "DATABASE_URL")) ||
    !isValidR2Endpoint(requiredValue(environment, "R2_ENDPOINT")) ||
    !BUCKET_NAME_PATTERN.test(requiredValue(environment, "R2_BUCKET_NAME") ?? "") ||
    !requiredValue(environment, "R2_ACCESS_KEY_ID") ||
    !requiredValue(environment, "R2_SECRET_ACCESS_KEY") ||
    !isValidUpstashEndpoint(requiredValue(environment, "UPSTASH_REDIS_REST_URL")) ||
    !requiredValue(environment, "UPSTASH_REDIS_REST_TOKEN") ||
    !["us", "eu"].includes(googleLocation ?? "") ||
    !processorId ||
    !PROCESSOR_ID_PATTERN.test(processorId) ||
    !isValidServiceAccount(serviceAccount, googleProjectId)
  ) return null;

  return {
    authMode: "firebase",
    ocrProvider: "google-document-ai",
    persistenceMode: "postgres",
    storageMode: "r2",
    rateLimitMode: "upstash",
  };
}

export function assertProductionConfiguration(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.NODE_ENV !== "production") return;
  if (!parseProductionConfiguration(environment)) throw new ProductionConfigurationError();
}
