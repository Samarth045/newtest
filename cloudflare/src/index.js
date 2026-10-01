const CORS = {
  "Access-Control-Allow-Origin": "https://samarth045.github.io",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-MMC-Device",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
};

function json(data, status=200, extra={}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"Content-Type":"application/json; charset=utf-8", ...CORS, ...extra}
  });
}

function originAllowed(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === "https://samarth045.github.io" || origin === "http://localhost:8787" || origin === "http://localhost:5173";
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

function randomId(prefix="") {
  return prefix + crypto.randomUUID().replaceAll("-","");
}

function validId(v) {
  return typeof v === "string" && /^[a-zA-Z0-9_-]{16,128}$/.test(v);
}

function auth(request) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const secret = header.slice(7).trim();
  return secret.length >= 24 ? secret : null;
}

async function readJson(request, maxBytes=900000) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len && len > maxBytes) throw new Error("Payload too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new Error("Payload too large");
  return JSON.parse(text);
}

async function getVault(env, vaultId) {
  return env.DB.prepare("SELECT * FROM vaults WHERE vault_id = ?").bind(vaultId).first();
}

async function requireVault(request, env, vaultId) {
  const secret = auth(request);
  if (!secret || !validId(vaultId)) return {error:"Unauthorized", status:401};
  const vault = await getVault(env, vaultId);
  if (!vault) return {error:"Vault not found", status:404};
  const hash = await sha256(secret);
  if (hash !== vault.secret_hash) return {error:"Unauthorized", status:401};
  return {vault, secret};
}

export default {
  async fetch(request, env) {
    try {
      if (!originAllowed(request)) return json({error:"Origin not allowed"}, 403);
      if (request.method === "OPTIONS") return new Response(null,{status:204,headers:CORS});

      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/,"") || "/";

      if (path === "/health" && request.method === "GET") {
        return json({ok:true,service:"My Money Control Sync",version:"1.0",time:new Date().toISOString()});
      }

      if (path === "/v1/vault" && request.method === "POST") {
        const body = await readJson(request, 20000);
        const vaultId = String(body.vaultId || "");
        const secret = String(body.secret || "");
        const deviceId = String(body.deviceId || "");
        const payload = body.payload;
        if (!validId(vaultId) || secret.length < 24 || deviceId.length < 8 || !payload || typeof payload !== "object") {
          return json({error:"Invalid vault creation request"},400);
        }
        const existing = await getVault(env,vaultId);
        if (existing) return json({error:"Vault already exists"},409);
        const payloadText = JSON.stringify(payload);
        const checksum = await sha256(payloadText);
        const now = new Date().toISOString();
        await env.DB.prepare(
          "INSERT INTO vaults(vault_id,secret_hash,revision,payload,checksum,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
        ).bind(vaultId,await sha256(secret),1,payloadText,checksum,now,now).run();
        await env.DB.prepare(
          "INSERT INTO sync_journal(vault_id,revision,device_id,action,checksum,payload_size,created_at) VALUES(?,?,?,?,?,?,?)"
        ).bind(vaultId,1,deviceId,"create",checksum,payloadText.length,now).run();
        return json({ok:true,vaultId,revision:1,checksum,updatedAt:now});
      }

      const match = path.match(/^\/v1\/vault\/([a-zA-Z0-9_-]{16,128})$/);
      if (!match) return json({error:"Not found"},404);
      const vaultId = match[1];
      const access = await requireVault(request,env,vaultId);
      if (access.error) return json({error:access.error},access.status);
      const vault = access.vault;

      if (request.method === "GET") {
        return json({
          ok:true,
          vaultId,
          revision:vault.revision,
          checksum:vault.checksum,
          updatedAt:vault.updated_at,
          payload:JSON.parse(vault.payload)
        });
      }

      if (request.method === "POST" || request.method === "PUT") {
        const body = await readJson(request);
        const baseRevision = Number(body.baseRevision);
        const deviceId = String(body.deviceId || request.headers.get("X-MMC-Device") || "");
        const action = String(body.action || "sync");
        const payload = body.payload;
        if (!Number.isInteger(baseRevision) || baseRevision < 0 || deviceId.length < 8 || !payload || typeof payload !== "object") {
          return json({error:"Invalid sync request"},400);
        }

        const payloadText = JSON.stringify(payload);
        const checksum = await sha256(payloadText);
        if (baseRevision !== vault.revision) {
          const now = new Date().toISOString();
          const conflict = await env.DB.prepare(
            "INSERT INTO sync_conflicts(vault_id,base_revision,server_revision,device_id,checksum,payload,created_at) VALUES(?,?,?,?,?,?,?) RETURNING id"
          ).bind(vaultId,baseRevision,vault.revision,deviceId,checksum,payloadText,now).first();
          return json({
            ok:false,
            conflict:true,
            conflictId:conflict?.id||null,
            server:{
              revision:vault.revision,
              checksum:vault.checksum,
              updatedAt:vault.updated_at,
              payload:JSON.parse(vault.payload)
            }
          },409);
        }

        const nextRevision=vault.revision+1;
        const now=new Date().toISOString();
        const batch=await env.DB.batch([
          env.DB.prepare(
            "UPDATE vaults SET revision=?,payload=?,checksum=?,updated_at=? WHERE vault_id=? AND revision=?"
          ).bind(nextRevision,payloadText,checksum,now,vaultId,vault.revision),
          env.DB.prepare(
            "INSERT INTO sync_journal(vault_id,revision,device_id,action,checksum,payload_size,created_at) VALUES(?,?,?,?,?,?,?)"
          ).bind(vaultId,nextRevision,deviceId,action,checksum,payloadText.length,now)
        ]);
        const changed=Number(batch?.[0]?.meta?.changes||0);
        if(changed!==1){
          const latest=await getVault(env,vaultId);
          return json({ok:false,conflict:true,conflictId:null,server:{revision:latest.revision,checksum:latest.checksum,updatedAt:latest.updated_at,payload:JSON.parse(latest.payload)}},409);
        }
        return json({ok:true,vaultId,revision:nextRevision,checksum,updatedAt:now});
      }

      return json({error:"Method not allowed"},405);
    } catch (e) {
      return json({error:String(e?.message || e || "Server error")},500);
    }
  }
};
