export async function createSnapshot(env, vaultId, reason="scheduled") {
  const vault = await env.DB.prepare("SELECT vault_id,revision,payload,checksum FROM vaults WHERE vault_id=?").bind(vaultId).first();
  if (!vault) throw new Error("Vault not found");
  const id = crypto.randomUUID().replaceAll("-","");
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO backup_snapshots(snapshot_id,vault_id,revision,reason,payload,checksum,created_at,verification_status) VALUES(?,?,?,?,?,?,?,?)")
    .bind(id,vaultId,vault.revision,reason,vault.payload,vault.checksum,now,"pending").run();
  return {snapshotId:id,vaultId,revision:vault.revision,checksum:vault.checksum,createdAt:now};
}

export async function listSnapshots(env, vaultId, limit=30) {
  return env.DB.prepare("SELECT snapshot_id,revision,reason,checksum,created_at,object_key,encrypted,verified_at,verification_status,size_bytes FROM backup_snapshots WHERE vault_id=? ORDER BY created_at DESC LIMIT ?")
    .bind(vaultId,Math.min(Math.max(Number(limit)||30,1),100)).all();
}

export async function getSnapshot(env, vaultId, snapshotId) {
  return env.DB.prepare("SELECT * FROM backup_snapshots WHERE vault_id=? AND snapshot_id=?").bind(vaultId,snapshotId).first();
}

export async function markSnapshot(env, snapshotId, fields={}) {
  const sets=[],values=[];
  if(fields.objectKey!==undefined){sets.push("object_key=?");values.push(fields.objectKey)}
  if(fields.encrypted!==undefined){sets.push("encrypted=?");values.push(fields.encrypted?1:0)}
  if(fields.verifiedAt!==undefined){sets.push("verified_at=?");values.push(fields.verifiedAt)}
  if(fields.verificationStatus!==undefined){sets.push("verification_status=?");values.push(fields.verificationStatus)}
  if(fields.sizeBytes!==undefined){sets.push("size_bytes=?");values.push(Number(fields.sizeBytes)||0)}
  if(!sets.length)return;
  values.push(snapshotId);
  await env.DB.prepare("UPDATE backup_snapshots SET "+sets.join(",")+" WHERE snapshot_id=?").bind(...values).run();
}

export async function pruneSnapshots(env, vaultId) {
  const rows=await env.DB.prepare("SELECT snapshot_id,reason,created_at,object_key FROM backup_snapshots WHERE vault_id=? ORDER BY created_at DESC").bind(vaultId).all();
  const list=rows.results||[];
  const limits={scheduled:14,manual:12,"pre-restore":8,emergency:4};
  const groups={};
  for(const row of list){const key=limits[row.reason]!==undefined?row.reason:"scheduled";(groups[key]||(groups[key]=[])).push(row)}
  const doomed=Object.entries(groups).flatMap(([reason,items])=>items.slice(limits[reason]));
  for(const row of doomed){
    await env.DB.prepare("DELETE FROM backup_snapshots WHERE snapshot_id=?").bind(row.snapshot_id).run();
    if(env.BACKUPS&&row.object_key)await env.BACKUPS.delete(row.object_key);
  }
  return doomed.length;
}