ALTER TABLE backup_snapshots ADD COLUMN object_key TEXT;
ALTER TABLE backup_snapshots ADD COLUMN encrypted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE backup_snapshots ADD COLUMN verified_at TEXT;
ALTER TABLE backup_snapshots ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE backup_snapshots ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_backup_snapshots_vault_created
  ON backup_snapshots(vault_id, created_at DESC);