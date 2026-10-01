

CREATE TABLE IF NOT EXISTS backup_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  reason TEXT NOT NULL,
  payload TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (vault_id) REFERENCES vaults(vault_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_backup_snapshots_vault_created
  ON backup_snapshots(vault_id, created_at DESC);
