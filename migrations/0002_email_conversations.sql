CREATE TABLE IF NOT EXISTS message_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'received', 'failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  gmail_message_id TEXT,
  last_error TEXT,
  claimed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_replies_gmail_message_id
  ON message_replies(gmail_message_id) WHERE gmail_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS message_email_threads (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_bridge (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pairing_hash TEXT,
  pairing_expires_at INTEGER,
  token_hash TEXT,
  google_email TEXT,
  connected_at TEXT,
  last_sync_at TEXT
);

