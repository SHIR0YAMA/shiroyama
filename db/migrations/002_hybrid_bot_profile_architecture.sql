ALTER TABLE users ADD COLUMN telegram_chat_id TEXT;
ALTER TABLE users ADD COLUMN telegram_username TEXT;
ALTER TABLE users ADD COLUMN link_code TEXT;

CREATE TABLE IF NOT EXISTS telegram_bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_name TEXT NOT NULL UNIQUE,
  bot_username TEXT,
  bot_token_ref TEXT,
  bot_token_enc TEXT,
  webhook_secret TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telegram_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL DEFAULT 'channel',
  telegram_chat_id TEXT NOT NULL UNIQUE,
  source_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bot_source_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  folder_path TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bot_id, source_id),
  FOREIGN KEY(bot_id) REFERENCES telegram_bots(id) ON DELETE CASCADE,
  FOREIGN KEY(source_id) REFERENCES telegram_sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bot_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL,
  source_id INTEGER,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'processed',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(bot_id) REFERENCES telegram_bots(id) ON DELETE CASCADE,
  FOREIGN KEY(source_id) REFERENCES telegram_sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS upload_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  file_id INTEGER,
  status TEXT NOT NULL DEFAULT 'completed',
  error_message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE SET NULL
);

ALTER TABLE files ADD COLUMN origin TEXT NOT NULL DEFAULT 'bot_sync';
ALTER TABLE files ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE files ADD COLUMN bot_id INTEGER;
ALTER TABLE files ADD COLUMN source_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_mappings_folder ON bot_source_mappings(folder_path);
CREATE INDEX IF NOT EXISTS idx_files_origin ON files(origin);
CREATE INDEX IF NOT EXISTS idx_files_source ON files(source_id);
