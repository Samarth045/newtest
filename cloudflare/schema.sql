PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS vaults (
  vault_id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vault_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  action TEXT NOT NULL,
  checksum TEXT NOT NULL,
  payload_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vault_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  server_revision INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  checksum TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_journal_vault_revision
  ON sync_journal(vault_id, revision);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_vault
  ON sync_conflicts(vault_id, resolved, created_at);


CREATE TABLE IF NOT EXISTS backup_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  reason TEXT NOT NULL,
  payload TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  object_key TEXT,
  encrypted INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_backup_snapshots_vault_created
  ON backup_snapshots(vault_id, created_at DESC);
