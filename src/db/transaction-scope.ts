import { AsyncLocalStorage } from "node:async_hooks";

import type { Database } from "./client";

type DatabaseScope = {
  database: Database;
  transaction: Database;
};

const databaseScope = new AsyncLocalStorage<DatabaseScope>();

export function databaseForOperation(database: Database): Database {
  const scope = databaseScope.getStore();
  return scope?.database === database ? scope.transaction : database;
}

export function transactionWithDatabase<T>(database: Database, operation: () => Promise<T>): Promise<T> {
  if (databaseScope.getStore()?.database === database) return operation();
  return database.transaction((transaction) => databaseScope.run({ database, transaction }, operation));
}
