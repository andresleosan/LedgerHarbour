import { AsyncLocalStorage } from "node:async_hooks";

import type { Database } from "./client";

const databaseScope = new AsyncLocalStorage<Database>();

export function databaseForOperation(database: Database): Database {
  return databaseScope.getStore() ?? database;
}

export function transactionWithDatabase<T>(database: Database, operation: () => Promise<T>): Promise<T> {
  return database.transaction((transaction) => databaseScope.run(transaction, operation));
}
