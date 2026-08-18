import { and, asc, count, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "../../db/client";
import { databaseForOperation, transactionWithDatabase } from "../../db/transaction-scope";
import { platformAuditEvents, platformMembers } from "../../db/schema";
import type { UserId } from "../tenancy/types";

export interface PlatformMember {
  id: string;
  userId: UserId | null;
  normalizedEmail: string;
  role: "platform_admin";
  isActive: boolean;
}

export interface PlatformAuditEvent {
  id: string;
  actorId: string;
  action: string;
  targetType: "business" | "membership" | "project" | "platform_member";
  targetId: string;
  beforeStatus: string | null;
  afterStatus: string | null;
  reason: string | null;
  createdAt: string;
}

export interface PlatformRepository {
  transaction?<T>(operation: (repository: PlatformRepository) => Promise<T>): Promise<T>;
  findActiveMemberByUserId(userId: UserId): Promise<PlatformMember | null>;
  listMembers(): Promise<PlatformMember[]>;
  findMemberForClaimByEmail(normalizedEmail: string): Promise<PlatformMember | null>;
  createMember(input: { id: string; normalizedEmail: string }): Promise<PlatformMember>;
  updateMemberStatus(memberId: string, isActive: boolean, expectedIsActive: boolean): Promise<PlatformMember>;
  countActiveMembers(): Promise<number>;
  lockActiveMembers(): Promise<void>;
  claimMemberByEmail(normalizedEmail: string, userId: UserId): Promise<PlatformMember | null>;
  linkMemberToUser(memberId: string, userId: UserId): Promise<PlatformMember | null>;
  appendAuditEvent(event: Omit<PlatformAuditEvent, "id" | "createdAt">): Promise<PlatformAuditEvent>;
  listAuditEvents(targetId: string): Promise<PlatformAuditEvent[]>;
  listAllAuditEvents(): Promise<PlatformAuditEvent[]>;
}

export class PlatformRepositoryConflictError extends Error {
  readonly name = "PlatformRepositoryConflictError";
}

export interface InMemoryPlatformRepository extends PlatformRepository {
  readonly platformMembers: PlatformMember[];
  readonly auditEvents: PlatformAuditEvent[];
  addMember(member: Omit<PlatformMember, "role" | "isActive"> & Partial<Pick<PlatformMember, "role" | "isActive">>): void;
}

const normalizeEmail = (value: string) => value.trim().toLocaleLowerCase("en-US");

class MemoryPlatformRepository implements InMemoryPlatformRepository {
  readonly platformMembers: PlatformMember[] = [];
  readonly auditEvents: PlatformAuditEvent[] = [];
  private nextAuditId = 1;
  private transactionTail: Promise<void> = Promise.resolve();

  async transaction<T>(operation: (repository: PlatformRepository) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const members = this.platformMembers.map((member) => ({ ...member }));
    const events = this.auditEvents.map((event) => ({ ...event }));
    const nextAuditId = this.nextAuditId;
    try {
      return await operation(this);
    } catch (error) {
      this.platformMembers.splice(0, this.platformMembers.length, ...members);
      this.auditEvents.splice(0, this.auditEvents.length, ...events);
      this.nextAuditId = nextAuditId;
      throw error;
    } finally {
      release();
    }
  }

  addMember(member: Omit<PlatformMember, "role" | "isActive"> & Partial<Pick<PlatformMember, "role" | "isActive">>): void {
    this.platformMembers.push({ role: "platform_admin", isActive: true, ...member });
  }

  async findActiveMemberByUserId(userId: UserId): Promise<PlatformMember | null> {
    return this.platformMembers.find((member) => member.userId === userId && member.isActive) ?? null;
  }

  async listMembers(): Promise<PlatformMember[]> {
    return this.platformMembers.map((member) => ({ ...member }));
  }

  async findMemberForClaimByEmail(normalizedEmail: string): Promise<PlatformMember | null> {
    return this.platformMembers.find((member) => member.normalizedEmail === normalizeEmail(normalizedEmail) && member.isActive) ?? null;
  }

  async createMember(input: { id: string; normalizedEmail: string }): Promise<PlatformMember> {
    const normalized = normalizeEmail(input.normalizedEmail);
    if (this.platformMembers.some((member) => member.normalizedEmail === normalized)) {
      throw new PlatformRepositoryConflictError("Platform administrator email already exists");
    }
    const member: PlatformMember = { id: input.id, userId: null, normalizedEmail: normalized, role: "platform_admin", isActive: true };
    this.platformMembers.push(member);
    return { ...member };
  }

  async updateMemberStatus(memberId: string, isActive: boolean, expectedIsActive: boolean): Promise<PlatformMember> {
    const member = this.platformMembers.find((candidate) => candidate.id === memberId && candidate.isActive === expectedIsActive);
    if (!member) throw new PlatformRepositoryConflictError("Platform administrator state changed elsewhere");
    member.isActive = isActive;
    return { ...member };
  }

  async countActiveMembers(): Promise<number> {
    return this.platformMembers.filter((member) => member.isActive).length;
  }

  async lockActiveMembers(): Promise<void> {}

  async claimMemberByEmail(normalizedEmail: string, userId: UserId): Promise<PlatformMember | null> {
    const member = this.platformMembers.find((candidate) =>
      candidate.normalizedEmail === normalizeEmail(normalizedEmail)
      && candidate.isActive
      && candidate.userId === null,
    );
    if (!member) return null;
    member.userId = userId;
    return { ...member };
  }

  async linkMemberToUser(memberId: string, userId: UserId): Promise<PlatformMember | null> {
    const member = this.platformMembers.find((candidate) => candidate.id === memberId && candidate.isActive && candidate.userId === null);
    if (!member) return null;
    member.userId = userId;
    return { ...member };
  }

  async appendAuditEvent(input: Omit<PlatformAuditEvent, "id" | "createdAt">): Promise<PlatformAuditEvent> {
    const event = { ...input, id: `platform-audit-${this.nextAuditId++}`, createdAt: new Date().toISOString() };
    this.auditEvents.push(event);
    return { ...event };
  }

  async listAuditEvents(targetId: string): Promise<PlatformAuditEvent[]> {
    return this.auditEvents.filter((event) => event.targetId === targetId).map((event) => ({ ...event }));
  }

  async listAllAuditEvents(): Promise<PlatformAuditEvent[]> {
    return this.auditEvents.map((event) => ({ ...event }));
  }
}

export function createInMemoryPlatformRepository(): InMemoryPlatformRepository {
  return new MemoryPlatformRepository();
}

function mapMember(row: typeof platformMembers.$inferSelect): PlatformMember {
  return {
    id: row.id,
    userId: row.userId as UserId | null,
    normalizedEmail: row.normalizedEmail,
    role: row.role,
    isActive: row.isActive,
  };
}

function mapAudit(row: typeof platformAuditEvents.$inferSelect): PlatformAuditEvent {
  return {
    id: row.id,
    actorId: row.actorId,
    action: row.action,
  targetType: row.targetType as "business" | "membership" | "project" | "platform_member",
    targetId: row.targetId,
    beforeStatus: row.beforeStatus,
    afterStatus: row.afterStatus,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createPostgresPlatformRepository(db: Database): PlatformRepository & {
  bootstrapMember(id: string, email: string): Promise<void>;
} {
  const repository: PlatformRepository & { bootstrapMember(id: string, email: string): Promise<void> } = {
    async transaction(operation) {
      return transactionWithDatabase(db, () => operation(createPostgresPlatformRepository(databaseForOperation(db))));
    },

    async findActiveMemberByUserId(userId) {
      const [row] = await databaseForOperation(db).select().from(platformMembers).where(and(
        eq(platformMembers.userId, userId),
        eq(platformMembers.isActive, true),
      )).limit(1);
      return row ? mapMember(row) : null;
    },

    async listMembers() {
      const rows = await databaseForOperation(db).select().from(platformMembers).orderBy(asc(platformMembers.createdAt), asc(platformMembers.id));
      return rows.map(mapMember);
    },

    async findMemberForClaimByEmail(email) {
      const [row] = await databaseForOperation(db).select().from(platformMembers).where(and(
        eq(platformMembers.normalizedEmail, normalizeEmail(email)),
        eq(platformMembers.isActive, true),
      )).limit(1);
      return row ? mapMember(row) : null;
    },

    async createMember(input) {
      try {
        const [row] = await databaseForOperation(db).insert(platformMembers).values({
          id: input.id,
          normalizedEmail: normalizeEmail(input.normalizedEmail),
          userId: null,
          role: "platform_admin",
          isActive: true,
        }).returning();
        if (!row) throw new PlatformRepositoryConflictError("Platform administrator was not created");
        return mapMember(row);
      } catch (error) {
        if (error instanceof PlatformRepositoryConflictError) throw error;
        throw new PlatformRepositoryConflictError("Platform administrator email already exists");
      }
    },

    async updateMemberStatus(memberId, isActive, expectedIsActive) {
      try {
        const [row] = await databaseForOperation(db).update(platformMembers)
          .set({ isActive, updatedAt: new Date() })
          .where(and(eq(platformMembers.id, memberId), eq(platformMembers.isActive, expectedIsActive)))
          .returning();
        if (!row) throw new PlatformRepositoryConflictError("Platform administrator state changed elsewhere");
        return mapMember(row);
      } catch (error) {
        if (error instanceof PlatformRepositoryConflictError) throw error;
        throw new PlatformRepositoryConflictError("Platform administrator could not be updated");
      }
    },

    async countActiveMembers() {
      const [row] = await databaseForOperation(db).select({ count: count() }).from(platformMembers).where(eq(platformMembers.isActive, true));
      return Number(row?.count ?? 0);
    },

    async lockActiveMembers() {
      await databaseForOperation(db).execute(sql`SELECT id FROM platform_members WHERE is_active = true ORDER BY id FOR UPDATE`);
    },

    async claimMemberByEmail(email, userId) {
      const [row] = await databaseForOperation(db).update(platformMembers)
        .set({ userId, updatedAt: new Date() })
        .where(and(
          eq(platformMembers.normalizedEmail, normalizeEmail(email)),
          eq(platformMembers.isActive, true),
          isNull(platformMembers.userId),
        ))
        .returning();
      return row ? mapMember(row) : null;
    },

    async linkMemberToUser(memberId, userId) {
      const [row] = await databaseForOperation(db).update(platformMembers)
        .set({ userId, updatedAt: new Date() })
        .where(and(eq(platformMembers.id, memberId), eq(platformMembers.isActive, true), isNull(platformMembers.userId)))
        .returning();
      return row ? mapMember(row) : null;
    },

    async appendAuditEvent(input) {
      const [row] = await databaseForOperation(db).insert(platformAuditEvents).values({
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        beforeStatus: input.beforeStatus,
        afterStatus: input.afterStatus,
        reason: input.reason,
      }).returning();
      if (!row) throw new Error("Platform audit event was not created");
      return mapAudit(row);
    },

    async listAuditEvents(targetId) {
      const rows = await databaseForOperation(db).select().from(platformAuditEvents)
        .where(eq(platformAuditEvents.targetId, targetId))
        .orderBy(asc(platformAuditEvents.createdAt), asc(platformAuditEvents.id));
      return rows.map(mapAudit);
    },

    async listAllAuditEvents() {
      const rows = await databaseForOperation(db).select().from(platformAuditEvents)
        .orderBy(asc(platformAuditEvents.createdAt), asc(platformAuditEvents.id));
      return rows.map(mapAudit);
    },

    async bootstrapMember(id, email) {
      await databaseForOperation(db).insert(platformMembers).values({ id, normalizedEmail: normalizeEmail(email) });
    },
  };
  return repository;
}
