export async function createSnapshot(env, vaultId, reason="scheduled") {
  const vault = await env.DB.prepare("SELECT vault_id,revision,payload,checksum,updated_at FROM vaults WHERE vault_id=?").bind(vaultId).first();
  if (!vault) throw new Error("Vault not found");
  const id = crypto.randomUUID().replaceAll("-","");
  const now = new Date().toISOString();
  const payload = vault.payload;
  const checksum = vault.checksum;
  await env.DB.prepare(
    "INSERT INTO backup_snapshots(snapshot_id,vault_id,revision,reason,payload,checksum,created_at) VALUES(?,?,?,?,?,?,?)"
  ).bind(id,vaultId,vault.revision,reason,payload,checksum,now).run();
  return {snapshotId:id,vaultId,revision:vault.revision,checksum,createdAt:now};
}

export async function listSnapshots(env, vaultId, limit=30) {
  return env.DB.prepare(
    "SELECT snapshot_id,revision,reason,checksum,created_at FROM backup_snapshots WHERE vault_id=? ORDER BY created_at DESC LIMIT ?"
  ).bind(vaultId,Math.min(Math.max(Number(limit)||30,1),100)).all();
}

export async function getSnapshot(env, vaultId, snapshotId) {
  return env.DB.prepare(
    "SELECT * FROM backup_snapshots WHERE vault_id=? AND snapshot_id=?"
  ).bind(vaultId,snapshotId).first();
}
