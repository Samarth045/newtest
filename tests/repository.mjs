// repository.mjs — relational, record-level data model for My Money Control.
//
// This is the storage-agnostic core of the repository layer. It operates on an
// in-memory "db" object whose shape mirrors the planned IndexedDB object stores:
//
//   { accounts:Map, transactions:Map, budgets:Map, recurring:Map, goals:Map,
//     outbox:[], journal:[], meta:{} }
//
// The real app will back these Maps with IndexedDB object stores, but keeping the
// logic pure here lets us unit-test every invariant the brief demands:
//   - adding a record never mutates another
//   - delete is a soft-delete tombstone (recoverable, sync-safe)
//   - every mutation gets a monotonic per-record rev + updatedAt
//   - every mutation appends a typed journal entry and an outbox entry
//
// Money is integer paise throughout (see money.mjs).

export const RECORD_TYPES = ["accounts", "transactions", "budgets", "recurring", "goals"];

export function createDb() {
  return {
    accounts: new Map(),
    transactions: new Map(),
    budgets: new Map(),
    recurring: new Map(),
    goals: new Map(),
    outbox: [],
    journal: [],
    meta: { localRevision: 0 },
  };
}

function nowIso(clock) {
  return (clock ? clock() : new Date()).toISOString();
}

function store(db, type) {
  if (!RECORD_TYPES.includes(type)) throw new Error("Unknown record type: " + type);
  return db[type];
}

// Append a typed journal entry (audit trail) and an outbox entry (pending sync).
function record(db, op, type, id, rev, clock) {
  const ts = nowIso(clock);
  db.journal.push({ op, type, id, rev, ts });
  db.outbox.push({ type, id, rev, op, ts });
  db.meta.localRevision = (db.meta.localRevision || 0) + 1;
}

// Insert or update a record by id. Returns the stored record.
// Never mutates any other record. Bumps rev and updatedAt.
export function put(db, type, rec, { clock } = {}) {
  const s = store(db, type);
  if (!rec || !rec.id) throw new Error("Record must have an id");
  const existing = s.get(rec.id);
  const rev = (existing ? existing.rev || 0 : 0) + 1;
  const op = existing ? "UPDATE" : "CREATE";
  const stored = {
    ...rec,
    rev,
    createdAt: existing ? existing.createdAt : nowIso(clock),
    updatedAt: nowIso(clock),
    deleted: false,
  };
  s.set(rec.id, stored);
  record(db, op + "_" + type.toUpperCase().replace(/S$/, ""), type, rec.id, rev, clock);
  return stored;
}

// Soft-delete: mark a tombstone instead of removing. Recoverable + sync-safe.
export function remove(db, type, id, { clock } = {}) {
  const s = store(db, type);
  const existing = s.get(id);
  if (!existing || existing.deleted) return false;
  const rev = (existing.rev || 0) + 1;
  s.set(id, { ...existing, deleted: true, rev, updatedAt: nowIso(clock) });
  record(db, "DELETE_" + type.toUpperCase().replace(/S$/, ""), type, id, rev, clock);
  return true;
}

// Live records of a type (tombstones excluded).
export function all(db, type) {
  return [...store(db, type).values()].filter((r) => !r.deleted);
}

export function get(db, type, id) {
  const r = store(db, type).get(id);
  return r && !r.deleted ? r : null;
}

// Pending outbox entries (what still needs to be pushed to the cloud).
export function pendingOutbox(db) {
  return db.outbox.slice();
}

export function clearOutbox(db, upToIndex) {
  db.outbox = db.outbox.slice(upToIndex);
}
