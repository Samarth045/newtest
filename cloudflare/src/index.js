import { createSnapshot, listSnapshots, getSnapshot, markSnapshot, pruneSnapshots } from "./backup.js";

const CORS = {
  "Access-Control-Allow-Origin": "https://samarth045.github.io",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-MMC-Device",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
};

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8",...CORS}})}
function originAllowed(request){const o=request.headers.get("Origin");return !o||o==="https://samarth045.github.io"||o==="http://localhost:8787"||o==="http://localhost:5173"}
async function sha256(value){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function validId(v){return typeof v==="string"&&/^[a-zA-Z0-9_-]{16,128}$/.test(v)}
function auth(request){const h=request.headers.get("Authorization")||"";if(!h.startsWith("Bearer "))return null;const s=h.slice(7).trim();return s.length>=24?s:null}
async function readJson(request,maxBytes=900000){const len=Number(request.headers.get("Content-Length")||0);if(len&&len>maxBytes)throw new Error("Payload too large");const text=await request.text();if(new TextEncoder().encode(text).length>maxBytes)throw new Error("Payload too large");return JSON.parse(text)}
async function getVault(env,vaultId){return env.DB.prepare("SELECT * FROM vaults WHERE vault_id=?").bind(vaultId).first()}
async function requireVault(request,env,vaultId){const secret=auth(request);if(!secret||!validId(vaultId))return{error:"Unauthorized",status:401};const vault=await getVault(env,vaultId);if(!vault)return{error:"Vault not found",status:404};if(await sha256(secret)!==vault.secret_hash)return{error:"Unauthorized",status:401};return{vault,secret}}

async function encryptForR2(secret,plaintext){
  const km=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),"PBKDF2",false,["deriveKey"]);
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:100000,hash:"SHA-256"},km,{name:"AES-GCM",length:256},false,["encrypt"]);
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(plaintext)));
  const out=new Uint8Array(28+cipher.length);out.set(salt,0);out.set(iv,16);out.set(cipher,28);return out;
}
async function decryptFromR2(secret,data){
  const bytes=new Uint8Array(data);if(bytes.length<29)throw new Error("Invalid backup object");
  const salt=bytes.slice(0,16),iv=bytes.slice(16,28),cipher=bytes.slice(28);
  const km=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),"PBKDF2",false,["deriveKey"]);
  const key=await crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:100000,hash:"SHA-256"},km,{name:"AES-GCM",length:256},false,["decrypt"]);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,cipher);
  return new TextDecoder().decode(plain);
}
async function writeSnapshotObject(env,secret,vault,snap){
  if(!env.BACKUPS)return null;
  const key="vaults/"+vault.vault_id+"/snapshots/"+snap.snapshotId+".bin";
  const encrypted=await encryptForR2(secret,vault.payload);
  await env.BACKUPS.put(key,encrypted,{httpMetadata:{contentType:"application/octet-stream"}});
  await markSnapshot(env,snap.snapshotId,{objectKey:key,encrypted:true,sizeBytes:encrypted.byteLength,verificationStatus:"pending"});
  return key;
}
async function readAndVerifySnapshot(env,secret,snap){
  let payload=snap.payload;
  if(env.BACKUPS&&snap.object_key){
    const obj=await env.BACKUPS.get(snap.object_key);if(!obj)throw new Error("R2 backup object not found");
    payload=await decryptFromR2(secret,await obj.arrayBuffer());
  }
  const checksum=await sha256(payload);
  if(checksum!==snap.checksum)throw new Error("Backup checksum verification failed");
  return payload;
}
async function createFullSnapshot(env,vault,secret,reason){
  const snap=await createSnapshot(env,vault.vault_id,reason);
  try{
    await writeSnapshotObject(env,secret,vault,snap);
    await markSnapshot(env,snap.snapshotId,{verifiedAt:null,verificationStatus:env.BACKUPS?"pending":"verified"});
    return snap;
  }catch(e){
    await markSnapshot(env,snap.snapshotId,{verificationStatus:"failed"});
    throw e;
  }
}

export default {async fetch(request,env){
  try{
    if(!originAllowed(request))return json({error:"Origin not allowed"},403);
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
    const url=new URL(request.url),path=url.pathname.replace(/\/+$/,"")||"/";
    if(path==="/health"&&request.method==="GET")return json({ok:true,service:"My Money Control Sync",version:"1.1",time:new Date().toISOString(),r2:!!env.BACKUPS});
    if(path==="/v1/vault"&&request.method==="POST"){
      const body=await readJson(request,20000),vaultId=String(body.vaultId||""),secret=String(body.secret||""),deviceId=String(body.deviceId||""),payload=body.payload;
      if(!validId(vaultId)||secret.length<24||deviceId.length<8||!payload||typeof payload!=="object")return json({error:"Invalid vault creation request"},400);
      if(await getVault(env,vaultId))return json({error:"Vault already exists"},409);
      const payloadText=JSON.stringify(payload),checksum=await sha256(payloadText),now=new Date().toISOString();
      await env.DB.prepare("INSERT INTO vaults(vault_id,secret_hash,revision,payload,checksum,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(vaultId,await sha256(secret),1,payloadText,checksum,now,now).run();
      await env.DB.prepare("INSERT INTO sync_journal(vault_id,revision,device_id,action,checksum,payload_size,created_at) VALUES(?,?,?,?,?,?,?)").bind(vaultId,1,deviceId,"create",checksum,payloadText.length,now).run();
      return json({ok:true,vaultId,revision:1,checksum,updatedAt:now});
    }

    const match=path.match(/^\/v1\/vault\/([a-zA-Z0-9_-]{16,128})(.*)$/);if(!match)return json({error:"Not found"},404);
    const vaultId=match[1],sub=match[2]||"",access=await requireVault(request,env,vaultId);if(access.error)return json({error:access.error},access.status);
    let vault=access.vault;

    if(sub==="/snapshots"&&request.method==="GET"){
      const rows=await listSnapshots(env,vaultId,url.searchParams.get("limit")||30);
      return json({ok:true,snapshots:rows.results||[]});
    }
    if(sub==="/snapshots"&&request.method==="POST"){
      const body=await readJson(request,5000),reason=String(body.reason||"manual");
      const snap=await createFullSnapshot(env,vault,access.secret,reason);
      await pruneSnapshots(env,vaultId,30);
      return json({ok:true,snapshot:{...snap,objectKey:env.BACKUPS?"vaults/"+vaultId+"/snapshots/"+snap.snapshotId+".bin":null,encrypted:!!env.BACKUPS}},201);
    }
    const verify=sub.match(/^\/snapshots\/([^/]+)\/verify$/);
    if(verify&&request.method==="POST"){
      const snap=await getSnapshot(env,vaultId,verify[1]);if(!snap)return json({error:"Snapshot not found"},404);
      try{const payload=await readAndVerifySnapshot(env,access.secret,snap),at=new Date().toISOString();await markSnapshot(env,verify[1],{verifiedAt:at,verificationStatus:"verified"});return json({ok:true,verified:true,snapshotId:verify[1],revision:snap.revision,checksum:snap.checksum,verifiedAt:at,sizeBytes:new TextEncoder().encode(payload).length});}
      catch(e){await markSnapshot(env,verify[1],{verificationStatus:"failed"});return json({ok:false,verified:false,error:e.message},422)}
    }
    const restore=sub.match(/^\/snapshots\/([^/]+)\/restore$/);
    if(restore&&request.method==="POST"){
      const target=await getSnapshot(env,vaultId,restore[1]);if(!target)return json({error:"Snapshot not found"},404);
      let payload;try{payload=await readAndVerifySnapshot(env,access.secret,target)}catch(e){await markSnapshot(env,restore[1],{verificationStatus:"failed"});return json({ok:false,error:"Target backup failed verification: "+e.message},422)}
      const pre=await createFullSnapshot(env,vault,access.secret,"pre-restore");
      const nextRevision=vault.revision+1,now=new Date().toISOString();
      const checksum=await sha256(payload);
      const batch=await env.DB.batch([
        env.DB.prepare("UPDATE vaults SET revision=?,payload=?,checksum=?,updated_at=? WHERE vault_id=? AND revision=?").bind(nextRevision,payload,checksum,now,vaultId,vault.revision),
        env.DB.prepare("INSERT INTO sync_journal(vault_id,revision,device_id,action,checksum,payload_size,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM vaults WHERE vault_id=? AND revision=?)").bind(vaultId,nextRevision,"recovery","restore:"+restore[1],checksum,payload.length,now,vaultId,nextRevision)
      ]);
      if(Number(batch?.[0]?.meta?.changes||0)!==1)return json({ok:false,error:"Restore lost a concurrency race; no restore applied."},409);
      return json({ok:true,restoredSnapshotId:restore[1],preRestoreSnapshotId:pre.snapshotId,revision:nextRevision,checksum,restoredAt:now});
    }
    if(sub==="/emergency-export"&&request.method==="GET"){
      const rows=await env.DB.prepare("SELECT * FROM backup_snapshots WHERE vault_id=? ORDER BY created_at DESC LIMIT 100").bind(vaultId).all();
      return json({ok:true,exportedAt:new Date().toISOString(),vault:{vaultId,revision:vault.revision,checksum:vault.checksum,updatedAt:vault.updated_at,payload:JSON.parse(vault.payload)},snapshots:rows.results||[]});
    }

    if(!sub&&request.method==="GET")return json({ok:true,vaultId,revision:vault.revision,checksum:vault.checksum,updatedAt:vault.updated_at,payload:JSON.parse(vault.payload)});
    if(!sub&&(request.method==="POST"||request.method==="PUT")){
      const body=await readJson(request),baseRevision=Number(body.baseRevision),deviceId=String(body.deviceId||request.headers.get("X-MMC-Device")||""),action=String(body.action||"sync"),payload=body.payload;
      if(!Number.isInteger(baseRevision)||baseRevision<0||deviceId.length<8||!payload||typeof payload!=="object")return json({error:"Invalid sync request"},400);
      const payloadText=JSON.stringify(payload),checksum=await sha256(payloadText);
      if(baseRevision!==vault.revision){
        const now=new Date().toISOString(),conflict=await env.DB.prepare("INSERT INTO sync_conflicts(vault_id,base_revision,server_revision,device_id,checksum,payload,created_at) VALUES(?,?,?,?,?,?,?) RETURNING id").bind(vaultId,baseRevision,vault.revision,deviceId,checksum,payloadText,now).first();
        return json({ok:false,conflict:true,conflictId:conflict?.id||null,server:{revision:vault.revision,checksum:vault.checksum,updatedAt:vault.updated_at,payload:JSON.parse(vault.payload)}},409);
      }
      const nextRevision=vault.revision+1,now=new Date().toISOString();
      const batch=await env.DB.batch([
        env.DB.prepare("UPDATE vaults SET revision=?,payload=?,checksum=?,updated_at=? WHERE vault_id=? AND revision=?").bind(nextRevision,payloadText,checksum,now,vaultId,vault.revision),
        env.DB.prepare("INSERT INTO sync_journal(vault_id,revision,device_id,action,checksum,payload_size,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM vaults WHERE vault_id=? AND revision=?)").bind(vaultId,nextRevision,deviceId,action,checksum,payloadText.length,now,vaultId,nextRevision)
      ]);
      if(Number(batch?.[0]?.meta?.changes||0)!==1){const latest=await getVault(env,vaultId);return json({ok:false,conflict:true,server:{revision:latest.revision,checksum:latest.checksum,updatedAt:latest.updated_at,payload:JSON.parse(latest.payload)}},409)}
      return json({ok:true,vaultId,revision:nextRevision,checksum,updatedAt:now});
    }
    return json({error:"Method not allowed"},405);
  }catch(e){return json({error:String(e?.message||e||"Server error")},500)}
}};