// repository.test.mjs — relational record-level invariants.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDb, put, remove, all, get, pendingOutbox } from "./repository.mjs";

// Deterministic clock for stable timestamps.
let t = 0;
const clock = () => new Date(1760000000000 + (t++ * 1000));

test("put creates a record with rev 1, timestamps, and not deleted", () => {
  const db = createDb();
  const r = put(db, "transactions", { id: "a", type: "expense", amount: 10000, account: "cash" }, { clock });
  assert.equal(r.rev, 1);
  assert.equal(r.deleted, false);
  assert.ok(r.createdAt && r.updatedAt);
  assert.equal(all(db, "transactions").length, 1);
});

test("adding a second record never mutates the first (no overwrite)", () => {
  const db = createDb();
  const a = put(db, "transactions", { id: "a", type: "expense", amount: 10000, account: "cash" }, { clock });
  const aSnap = JSON.stringify(a);
  put(db, "transactions", { id: "b", type: "expense", amount: 25000, account: "cash" }, { clock });
  assert.equal(JSON.stringify(get(db, "transactions", "a")), aSnap, "record a must be untouched");
  assert.equal(all(db, "transactions").length, 2);
});

test("three identical-valued records with distinct ids all persist", () => {
  const db = createDb();
  put(db, "transactions", { id: "f1", type: "expense", amount: 10000, category: "Food" }, { clock });
  put(db, "transactions", { id: "f2", type: "expense", amount: 10000, category: "Food" }, { clock });
  put(db, "transactions", { id: "f3", type: "expense", amount: 10000, category: "Food" }, { clock });
  assert.equal(all(db, "transactions").length, 3);
  const total = all(db, "transactions").reduce((s, r) => s + r.amount, 0);
  assert.equal(total, 30000);
});

test("update bumps rev and preserves createdAt", () => {
  const db = createDb();
  const a1 = put(db, "transactions", { id: "a", type: "expense", amount: 10000 }, { clock });
  const a2 = put(db, "transactions", { id: "a", type: "expense", amount: 15000 }, { clock });
  assert.equal(a2.rev, 2);
  assert.equal(a2.amount, 15000);
  assert.equal(a2.createdAt, a1.createdAt, "createdAt preserved across update");
  assert.notEqual(a2.updatedAt, a1.updatedAt);
});

test("soft-delete tombstones a record without affecting others", () => {
  const db = createDb();
  put(db, "transactions", { id: "a", type: "expense", amount: 10000 }, { clock });
  put(db, "transactions", { id: "b", type: "expense", amount: 20000 }, { clock });
  const ok = remove(db, "transactions", "a", { clock });
  assert.equal(ok, true);
  assert.equal(get(db, "transactions", "a"), null, "a hidden from live reads");
  assert.ok(get(db, "transactions", "b"), "b untouched");
  assert.equal(all(db, "transactions").length, 1);
  // Tombstone still physically present (recoverable / sync-safe).
  assert.equal(db.transactions.get("a").deleted, true);
  assert.equal(db.transactions.get("a").rev, 2);
});

test("deleting one record never deletes another", () => {
  const db = createDb();
  ["a", "b", "c"].forEach((id, i) => put(db, "transactions", { id, amount: (i + 1) * 1000 }, { clock }));
  remove(db, "transactions", "b", { clock });
  assert.deepEqual(all(db, "transactions").map((r) => r.id).sort(), ["a", "c"]);
});

test("every mutation appends a typed journal entry and an outbox entry", () => {
  const db = createDb();
  put(db, "transactions", { id: "a", amount: 1000 }, { clock });
  put(db, "accounts", { id: "cash", name: "Cash", opening: 0 }, { clock });
  remove(db, "transactions", "a", { clock });
  const ops = db.journal.map((j) => j.op);
  assert.deepEqual(ops, ["CREATE_TRANSACTION", "CREATE_ACCOUNT", "DELETE_TRANSACTION"]);
  assert.equal(pendingOutbox(db).length, 3, "three pending changes to sync");
  assert.equal(db.meta.localRevision, 3);
});

test("double-delete is a no-op (idempotent)", () => {
  const db = createDb();
  put(db, "transactions", { id: "a", amount: 1000 }, { clock });
  assert.equal(remove(db, "transactions", "a", { clock }), true);
  assert.equal(remove(db, "transactions", "a", { clock }), false, "second delete does nothing");
});

test("unknown record type throws rather than corrupting data", () => {
  const db = createDb();
  assert.throws(() => put(db, "nonsense", { id: "x" }, { clock }));
});
