import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types";

/** Small dependency-injection surface. Repositories never need to know about Env. */
export interface DatabaseClient {
  prepare(sql: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

export function createDatabaseClient(database: D1Database): DatabaseClient {
  return {
    prepare: (sql) => database.prepare(sql),
    batch: <T = Record<string, unknown>>(statements: D1PreparedStatement[]) => database.batch<T>(statements),
  };
}
