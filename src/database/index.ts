/** Keep D1 access direct and explicit. Domain repositories begin in Phase 01. */
export function prepareStatement(
  database: D1Database,
  sql: string,
): D1PreparedStatement {
  return database.prepare(sql);
}

export function databaseFrom(env: Pick<Env, "DB">): D1Database {
  return env.DB;
}
