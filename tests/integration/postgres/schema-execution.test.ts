import { describe, expect, it } from "vitest";

import { createTestDatabase } from "../../../src/db/test-database";

describe("PostgreSQL initial migration", () => {
  it("executes the schema with tenant and audit integrity contracts", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const tables = await db.execute<{ table_name: string }>(
        `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public'
          ORDER BY table_name
        `,
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "audit_events",
        "businesses",
        "categories",
        "currencies",
        "documents",
        "invoices",
        "jobs",
        "join_requests",
        "memberships",
        "platform_audit_events",
        "platform_members",
        "users",
      ]);

      const enumValues = await db.execute<{ typname: string; enumlabel: string }>(
        `
          SELECT types.typname, enum_values.enumlabel
          FROM pg_type AS types
          JOIN pg_enum AS enum_values ON enum_values.enumtypid = types.oid
          WHERE types.typnamespace = 'public'::regnamespace
          ORDER BY types.typname, enum_values.enumsortorder
        `,
      );
      expect(enumValues.rows).toEqual([
        { typname: "audit_actor_type", enumlabel: "user" },
        { typname: "audit_actor_type", enumlabel: "system" },
        { typname: "base_currency_kind", enumlabel: "standard" },
        { typname: "base_currency_kind", enumlabel: "custom" },
        { typname: "document_status", enumlabel: "uploaded" },
        { typname: "document_status", enumlabel: "processing" },
        { typname: "document_status", enumlabel: "needs_review" },
        { typname: "document_status", enumlabel: "approved" },
        { typname: "document_status", enumlabel: "failed" },
        { typname: "invoice_review_state", enumlabel: "draft" },
        { typname: "invoice_review_state", enumlabel: "needs_review" },
        { typname: "invoice_review_state", enumlabel: "approved" },
        { typname: "job_status", enumlabel: "queued" },
        { typname: "job_status", enumlabel: "processing" },
        { typname: "job_status", enumlabel: "completed" },
        { typname: "job_status", enumlabel: "failed" },
        { typname: "join_request_status", enumlabel: "pending" },
        { typname: "join_request_status", enumlabel: "approved" },
        { typname: "join_request_status", enumlabel: "rejected" },
        { typname: "membership_role", enumlabel: "owner_admin" },
        { typname: "membership_role", enumlabel: "general_admin" },
        { typname: "membership_role", enumlabel: "administrator" },
        { typname: "platform_role", enumlabel: "platform_admin" },
        { typname: "verification_state", enumlabel: "unverified" },
        { typname: "verification_state", enumlabel: "verified" },
      ]);

      const constraints = await db.execute<{
        conname: string;
        contype: string;
        definition: string;
      }>(
        `
          SELECT conname, contype, pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
          WHERE conname IN (
          'documents_uploader_business_fk',
          'invoices_business_document_fk',
          'jobs_business_document_fk',
          'jobs_requested_by_business_fk'
          )
          ORDER BY conname
        `,
      );
      expect(constraints.rows).toEqual([
        {
          conname: "documents_uploader_business_fk",
          contype: "f",
          definition:
            "FOREIGN KEY (uploader_id, business_id) REFERENCES memberships(user_id, business_id)",
        },
        {
          conname: "invoices_business_document_fk",
          contype: "f",
          definition:
            "FOREIGN KEY (business_id, document_id) REFERENCES documents(business_id, id)",
        },
        {
          conname: "jobs_business_document_fk",
          contype: "f",
          definition:
            "FOREIGN KEY (business_id, document_id) REFERENCES documents(business_id, id)",
        },
        {
          conname: "jobs_requested_by_business_fk",
          contype: "f",
          definition:
            "FOREIGN KEY (requested_by, business_id) REFERENCES memberships(user_id, business_id)",
        },
      ]);

      const directDocumentUserForeignKeys = await db.execute<{ conname: string }>(`
        SELECT conname
        FROM pg_constraint
        WHERE conname LIKE 'documents%uploader%users%'
      `);
      expect(directDocumentUserForeignKeys.rows).toHaveLength(0);

      const triggers = await db.execute<{ trigger_name: string }>(
        `
          SELECT DISTINCT trigger_name
          FROM information_schema.triggers
          WHERE trigger_schema = 'public'
            AND trigger_name IN (
              'audit_events_append_only',
              'memberships_exactly_one_active_owner'
            )
          ORDER BY trigger_name
        `,
      );
      expect(triggers.rows.map((row) => row.trigger_name)).toEqual([
        "audit_events_append_only",
        "memberships_exactly_one_active_owner",
      ]);

      const indexes = await db.execute<{ indexname: string }>(
        `
          SELECT indexname
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'memberships_one_active_owner_per_business',
              'documents_business_object_key_unique',
              'audit_events_business_created_at_idx'
            )
          ORDER BY indexname
        `,
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        "audit_events_business_created_at_idx",
        "documents_business_object_key_unique",
        "memberships_one_active_owner_per_business",
      ]);

      const indexDefinitions = await db.execute<{
        indexname: string;
        indexdef: string;
      }>(
        `
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'memberships_one_active_owner_per_business',
              'documents_business_object_key_unique',
              'audit_events_business_created_at_idx'
            )
          ORDER BY indexname
        `,
      );
      expect(indexDefinitions.rows).toEqual([
        {
          indexname: "audit_events_business_created_at_idx",
          indexdef:
            "CREATE INDEX audit_events_business_created_at_idx ON public.audit_events USING btree (business_id, created_at)",
        },
        {
          indexname: "documents_business_object_key_unique",
          indexdef:
            "CREATE UNIQUE INDEX documents_business_object_key_unique ON public.documents USING btree (business_id, private_object_key)",
        },
        {
          indexname: "memberships_one_active_owner_per_business",
          indexdef:
            "CREATE UNIQUE INDEX memberships_one_active_owner_per_business ON public.memberships USING btree (business_id) WHERE ((role = 'owner_admin'::membership_role) AND (is_active = true))",
        },
      ]);
    } finally {
      await close();
    }
  }, 30_000);

  it("enforces exactly one active Owner Admin at transaction commit", async () => {
    const { db, close } = await createTestDatabase();

    try {
      await db.transaction(async (transaction) => {
        await transaction.execute(
          `INSERT INTO users (id, provider_id, email, normalized_email, display_name)
           VALUES ('user-1', 'provider-1', 'owner@example.com', 'owner@example.com', 'Owner')`,
        );
        await transaction.execute(
          `INSERT INTO businesses (id, name, normalized_search_name)
           VALUES ('business-1', 'Acme Ltd', 'acme ltd')`,
        );
        await transaction.execute(
          `INSERT INTO memberships (id, user_id, business_id, role)
           VALUES ('membership-1', 'user-1', 'business-1', 'owner_admin')`,
        );
      });

      await expect(
        db.transaction(async (transaction) => {
          await transaction.execute(
            `UPDATE memberships SET is_active = false, status = 'suspended'
             WHERE id = 'membership-1'`,
          );
        }),
      ).rejects.toThrow(/exactly one active Owner Admin/);

      await db.execute(
        `INSERT INTO users (id, provider_id, email, normalized_email, display_name)
         VALUES ('user-2', 'provider-2', 'admin@example.com', 'admin@example.com', 'Admin')`,
      );
      await db.execute(
        `INSERT INTO memberships (id, user_id, business_id, role)
         VALUES ('membership-2', 'user-2', 'business-1', 'administrator')`,
      );

      await expect(
        db.transaction(async (transaction) => {
          await transaction.execute(
            `UPDATE memberships SET role = 'owner_admin'
             WHERE id = 'membership-2'`,
          );
        }),
      ).rejects.toThrow();

      const owners = await db.execute<{ user_id: string }>(
        `SELECT user_id FROM memberships
         WHERE business_id = 'business-1' AND role = 'owner_admin' AND is_active = true`,
      );
      expect(owners.rows).toEqual([{ user_id: "user-1" }]);
    } finally {
      await close();
    }
  }, 30_000);

  it("stores explicit administrator lifecycle status independently from access", async () => {
    const { db, close } = await createTestDatabase();

    try {
      const columns = await db.execute<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'memberships' AND column_name = 'status'
      `);
      expect(columns.rows).toEqual([{ column_name: "status" }]);
      await db.execute(`
        INSERT INTO users (id, provider_id, email, normalized_email, display_name)
        VALUES ('status-user', 'status-provider', 'status@example.com', 'status@example.com', 'Status User')
      `);
      await db.execute(`
        INSERT INTO businesses (id, name, normalized_search_name, base_currency_kind, base_currency_code, base_currency_id, created_by, status, is_active)
        VALUES ('status-business', 'Status Harbour', 'status harbour', 'standard', 'GBP', NULL, 'status-user', 'pending', false)
      `);
      await expect(db.execute(`
        INSERT INTO memberships (id, user_id, business_id, role, is_active, status)
        VALUES ('membership-invalid-status', 'status-user', 'status-business', 'administrator', false, 'invalid')
      `)).rejects.toThrow();
      await expect(db.execute(`
        INSERT INTO memberships (id, user_id, business_id, role, is_active, status)
        VALUES ('membership-inconsistent-status', 'status-user', 'status-business', 'administrator', true, 'suspended')
      `)).rejects.toThrow();
    } finally {
      await close();
    }
  }, 30_000);

  it("enforces tenant-aware foreign keys and append-only audit events", async () => {
    const { db, close } = await createTestDatabase();

    try {
      await db.transaction(async (transaction) => {
        await transaction.execute(
          `INSERT INTO users (id, provider_id, email, normalized_email, display_name)
           VALUES ('user-1', 'provider-1', 'owner@example.com', 'owner@example.com', 'Owner'),
                  ('user-2', 'provider-2', 'other@example.com', 'other@example.com', 'Other')`,
        );
        await transaction.execute(
          `INSERT INTO businesses (id, name, normalized_search_name)
           VALUES ('business-1', 'Acme Ltd', 'acme ltd'),
                  ('business-2', 'Other Ltd', 'other ltd')`,
        );
        await transaction.execute(
          `INSERT INTO memberships (id, user_id, business_id, role)
           VALUES ('membership-1', 'user-1', 'business-1', 'owner_admin'),
                  ('membership-2', 'user-2', 'business-2', 'owner_admin')`,
        );
        await transaction.execute(
          `INSERT INTO audit_events (id, business_id, actor_type, action, entity_type, entity_id)
           VALUES ('audit-1', 'business-1', 'system', 'created', 'document', 'document-1')`,
        );
      });

      await expect(
        db.execute(
          `INSERT INTO documents
            (id, business_id, uploader_id, private_object_key, original_file_name,
             original_mime_type, original_size_bytes)
           VALUES ('document-1', 'business-1', 'user-2', 'private/document-1', 'invoice.pdf',
                   'application/pdf', 100)`,
        ),
      ).rejects.toThrow();

      await db.execute(
        `INSERT INTO documents
          (id, business_id, uploader_id, private_object_key, original_file_name,
           original_mime_type, original_size_bytes)
         VALUES ('document-1', 'business-1', 'user-1', 'private/document-1', 'invoice.pdf',
                 'application/pdf', 100)`,
      );
      await expect(
        db.execute(
          `INSERT INTO invoices (id, business_id, document_id)
           VALUES ('invoice-1', 'business-2', 'document-1')`,
        ),
      ).rejects.toThrow();
      await expect(
        db.execute(
          `INSERT INTO jobs (id, business_id, document_id)
           VALUES ('job-1', 'business-2', 'document-1')`,
        ),
      ).rejects.toThrow();

      await expect(
        db.execute(
          `UPDATE audit_events SET action = 'changed' WHERE id = 'audit-1'`,
        ),
      ).rejects.toThrow();
      await expect(
        db.execute(`DELETE FROM audit_events WHERE id = 'audit-1'`),
      ).rejects.toThrow();

      const auditEvents = await db.execute<{ id: string; action: string }>(
        `SELECT id, action FROM audit_events WHERE id = 'audit-1'`,
      );
      expect(auditEvents.rows).toEqual([{ id: "audit-1", action: "created" }]);
    } finally {
      await close();
    }
  }, 30_000);
});
