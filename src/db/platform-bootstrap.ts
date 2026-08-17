import { randomUUID } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";

export type PlatformBootstrapDatabase = {
  execute(query: SQL | string): Promise<unknown>;
};

export type PlatformBootstrapResult = {
  created: number;
  normalizedEmails: string[];
};

export function normalizePlatformAdminEmail(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (!/^([^\s@]+)@([^\s@]+)\.([^\s@]+)$/.test(normalized)) {
    throw new Error("Each platform administrator must be a valid email address");
  }
  return normalized;
}

export function resolvePlatformAdminEmails(args: readonly string[]): string[] {
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (argument === "--emails") {
      const value = args[index + 1];
      if (!value) throw new Error("--emails requires at least one email address");
      values.push(...value.split(","));
      index += 1;
      continue;
    }
    if (argument.startsWith("--emails=")) {
      values.push(...argument.slice("--emails=".length).split(","));
      continue;
    }
    throw new Error("Only the explicit --emails argument is supported");
  }

  const normalized = [...new Set(values.map(normalizePlatformAdminEmail))];
  if (normalized.length === 0) throw new Error("At least one platform administrator email is required");
  return normalized;
}

function returnedRows(result: unknown): unknown[] {
  if (!result || typeof result !== "object") return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows : [];
}

export async function bootstrapPlatformAdmins(
  db: PlatformBootstrapDatabase,
  emails: readonly string[],
): Promise<PlatformBootstrapResult> {
  const normalizedEmails = [...new Set(emails.map(normalizePlatformAdminEmail))];
  if (normalizedEmails.length === 0) throw new Error("At least one platform administrator email is required");

  const values = sql.join(
    normalizedEmails.map((email) => sql`(${randomUUID()}, ${email}, 'platform_admin', true)`),
    sql`, `,
  );
  const result = await db.execute(sql`
    INSERT INTO platform_members (id, normalized_email, role, is_active)
    VALUES ${values}
    ON CONFLICT (normalized_email) DO NOTHING
    RETURNING id
  `);

  return { created: returnedRows(result).length, normalizedEmails };
}
