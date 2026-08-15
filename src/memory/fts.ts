import type { DatabaseClient } from "../database/client";

export interface SearchIndexRecord {
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly title: string;
  readonly pathOrUrl?: string | null;
  readonly contentText: string;
  readonly tagsText?: string;
  readonly authority: number;
  readonly updatedAt: string;
}

export async function replaceMemorySearchRecord(
  database: DatabaseClient,
  record: SearchIndexRecord,
): Promise<void> {
  await database.batch([
    database
      .prepare("DELETE FROM institutional_memory_fts WHERE source_kind = ? AND source_id = ?")
      .bind(record.sourceKind, record.sourceId),
    database
      .prepare(
        `INSERT INTO institutional_memory_fts (
          source_kind, source_id, title, path_or_url, content_text,
          tags_text, authority, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.sourceKind,
        record.sourceId,
        record.title,
        record.pathOrUrl ?? null,
        record.contentText,
        record.tagsText ?? "",
        record.authority,
        record.updatedAt,
      ),
  ]);
}

export async function removeMemorySearchRecord(
  database: DatabaseClient,
  sourceKind: string,
  sourceId: string,
): Promise<void> {
  await database
    .prepare("DELETE FROM institutional_memory_fts WHERE source_kind = ? AND source_id = ?")
    .bind(sourceKind, sourceId)
    .run();
}
