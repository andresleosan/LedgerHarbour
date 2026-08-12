import { describe, expect, it } from "vitest";
import { Pool } from "pg";

import { createDbClient } from "../../../src/db/client";
import { createTestDatabase } from "../../../src/db/test-database";
import { createPostgresDocumentRepository } from "../../../src/modules/documents/postgres-document-repository";

describe("PostgreSQL database contract", () => {
  it("creates a node-postgres Drizzle database with transaction support without connecting", async () => {
    const pool = new Pool({ connectionString: "postgresql://local-test-only.invalid/ledgerharbour" });
    const db = createDbClient(pool);

    expect(typeof db.transaction).toBe("function");
    await pool.end();
  });

  it("rolls back through the common Database transaction contract", async () => {
    const { db, close } = await createTestDatabase();
    try {
      const repository = createPostgresDocumentRepository(db);
      await expect(repository.transaction(async () => {
        throw new Error("rollback sentinel");
      })).rejects.toMatchObject({ code: "DOCUMENT_STORAGE_FAILURE" });
    } finally {
      await close();
    }
  }, 30_000);
});
