import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { Client, Pool, PoolClient } from "pg";

import { schema } from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export type NodePostgresClient = Pool | Client | PoolClient;

export function createDbClient(client: NodePostgresClient): Database {
  return drizzle(client, { schema });
}
