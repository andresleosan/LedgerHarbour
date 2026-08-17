import { and, asc, eq, isNull } from "drizzle-orm";

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
  targetType: "business";
  targetId: string;
  beforeStatus: string | null;
  afterStatus: string | null;
  reason: string | null;
  createdAt: string;
}

export interface PlatformRepository {
  transaction?<T>(operation: (repository: PlatformRepository) => Promise<T>): Promise<T>;
  findActiveMemberByUserId(userId: UserId): Promise<PlatformMember | null>;
  findMemberForClaimByEmail(normalizedEmail: string): Promise<PlatformMember | null>;
  claimMemberByEmail(normalizedEmail: string, userId: UserId): Promise<PlatformMember | null>;
  linkMemberToUser(memberId: string, userId: UserId): Promise<PlatformMember | null>;
  appendAuditEvent(event: Omit<PlatformAuditEvent, "id" | "createdAt">): Promise<PlatformAuditEvent>;
  listAuditEvents(targetId: string): Promise<PlatformAuditEvent[]>;
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

  async findMemberForClaimByEmail(normalizedEmail: string): Promise<PlatformMember | null> {
    return this.platformMembers.find((member) => member.normalizedEmail === normalizeEmail(normalizedEmail) && member.isActive) ?? null;
  }

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
    targetType: row.targetType as "business",
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

    async findMemberForClaimByEmail(email) {
      const [row] = await databaseForOperation(db).select().from(platformMembers).where(and(
        eq(platformMembers.normalizedEmail, normalizeEmail(email)),
        eq(platformMembers.isActive, true),
      )).limit(1);
      return row ? mapMember(row) : null;
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

    async bootstrapMember(id, email) {
      await databaseForOperation(db).insert(platformMembers).values({ id, normalizedEmail: normalizeEmail(email) });
    },
  };
  return repository;
}
