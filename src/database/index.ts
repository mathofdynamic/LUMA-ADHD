/** Keep D1 access direct and explicit; runtime code should use repositories. */
export function prepareStatement(database: D1Database, sql: string): D1PreparedStatement {
  return database.prepare(sql);
}

export function databaseFrom(env: Pick<Env, "DB">): D1Database {
  return env.DB;
}

export { createDatabaseClient, type DatabaseClient } from "./client";
export * from "./errors";
export * from "./ids";
export * from "./repositories";
export * from "./types";
export * from "./validation";
