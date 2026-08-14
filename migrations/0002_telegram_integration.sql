-- Phase 02: preserve one-to-many Telegram projections for long messages.
-- The canonical message remains in messages; this table records every
-- Telegram message emitted for a single internal message.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS telegram_outbound_parts (
  id TEXT PRIMARY KEY NOT NULL,
  outbound_id TEXT NOT NULL,
  part_index INTEGER NOT NULL CHECK (part_index >= 0),
  text TEXT NOT NULL CHECK (length(text) > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'sent', 'failed')),
  telegram_message_id TEXT,
  reply_to_telegram_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  FOREIGN KEY (outbound_id) REFERENCES telegram_outbound(id),
  UNIQUE (outbound_id, part_index)
);

CREATE INDEX IF NOT EXISTS idx_telegram_outbound_parts_delivery
  ON telegram_outbound_parts (outbound_id, status, part_index);

CREATE INDEX IF NOT EXISTS idx_telegram_outbound_parts_message
  ON telegram_outbound_parts (telegram_message_id)
  WHERE telegram_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_telegram_update
  ON messages (telegram_bot_alias, telegram_update_id)
  WHERE telegram_update_id IS NOT NULL;
