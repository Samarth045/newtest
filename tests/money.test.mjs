// money.test.mjs — integer-paise correctness and migration equivalence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toPaise, toRupees, formatPaise, isValidPaise, migrateStateToPaise } from "./money.mjs";
import * as core from "./finance-core.mjs";

test("toPaise converts whole and fractional rupees exactly", () => {
  assert.equal(toPaise(100), 10000);
  assert.equal(toPaise(100.5), 10050);
  assert.equal(toPaise("19.99"), 1999);
  assert.equal(toPaise(0.01), 1);
  assert.equal(toPaise(0), 0);
});

test("toPaise absorbs float representation noise", () => {
  // Classic float traps that must not lose a paisa.
  assert.equal(toPaise(0.1 + 0.2), 30); // 0.30000000000000004 -> 30
  assert.equal(toPaise(19.99), 1999);
  assert.equal(toPaise(1.005), 101); // rounds to nearest paise
});

test("toRupees is the inverse of toPaise for valid amounts", () => {
  for (const r of [100, 100.5, 19.99, 0.01, 12345.67]) {
    assert.equal(toRupees(toPaise(r)), r);
  }
});

test("formatPaise matches the app's rupee display", () => {
  assert.equal(formatPaise(10000), "₹100"); // 10000 paise = ₹100
  assert.equal(formatPaise(100000000), "₹10,00,000"); // 10 crore paise = ₹10,00,000 (Indian grouping)
  assert.equal(formatPaise(150050), "₹1,501"); // 150050 paise = ₹1500.50 -> rounded ₹1,501
  assert.equal(formatPaise(150050, { withDecimals: true }), "₹1,500.50");
});

test("isValidPaise rejects non-integers, zero, and negatives", () => {
  assert.equal(isValidPaise(10000), true);
  assert.equal(isValidPaise(0), false);
  assert.equal(isValidPaise(-5), false);
  assert.equal(isValidPaise(10.5), false);
  assert.equal(isValidPaise(NaN), false);
});

// --- Equivalence: paise-based math must equal float-based math (in rupees) ---

function floatState() {
  return {
    accounts: [
      { id: "hdfc", name: "HDFC", opening: 10000, minBalance: 20000 },
      { id: "cash", name: "Cash", opening: 500.5, minBalance: 0 },
      { id: "kotak", name: "Kotak", opening: 0, minBalance: 0 },
    ],
    tx: [
      { id: "a", type: "income", amount: 5000, account: "hdfc", date: "2026-10-01" },
      { id: "b", type: "expense", amount: 299.99, account: "cash", category: "Food", date: "2026-10-02" },
      { id: "c", type: "transfer", amount: 2000, account: "hdfc", to: "cash", date: "2026-10-03" },
      { id: "d", type: "investment", amount: 20000, account: "hdfc", category: "MF SIP", date: "2026-10-04" },
      { id: "e", type: "payback", amount: 150.25, account: "cash", to: "kotak", date: "2026-10-05" },
    ],
  };
}

// Paise-space balance using the same semantics as finance-core, but on integers.
function balancePaise(state, id) {
  const OUT = core.OUT, TRANSFERISH = core.TRANSFERISH;
  let v = (state.accounts.find((a) => a.id === id) || { opening: 0 }).opening;
  for (const t of state.tx) {
    if (t.type === "income" && t.account === id) v += t.amount;
    if (OUT.includes(t.type) && t.account === id) v -= t.amount;
    if (TRANSFERISH.includes(t.type)) {
      if (t.account === id) v -= t.amount;
      if (t.to === id) v += t.amount;
    }
  }
  return v;
}

test("MIGRATION EQUIVALENCE: paise balances equal float balances for every account", () => {
  const fs = floatState();
  const ps = migrateStateToPaise(fs);
  for (const a of fs.accounts) {
    const floatBal = core.balance(fs, a.id);
    const paiseBal = balancePaise(ps, a.id);
    assert.equal(
      toRupees(paiseBal),
      Math.round(floatBal * 100) / 100,
      `account ${a.id}: paise balance ${toRupees(paiseBal)} must equal float balance ${floatBal}`
    );
  }
});

test("MIGRATION EQUIVALENCE: monthly outflow/income match after migration", () => {
  const fs = floatState();
  const ps = migrateStateToPaise(fs);
  const m = "2026-10";
  const outflowPaise = ps.tx.filter((t) => core.inMonth(t, m) && core.OUT.includes(t.type)).reduce((a, t) => a + t.amount, 0);
  const incomePaise = ps.tx.filter((t) => core.inMonth(t, m) && t.type === "income").reduce((a, t) => a + t.amount, 0);
  assert.equal(toRupees(outflowPaise), core.outflow(fs, m));
  assert.equal(toRupees(incomePaise), core.income(fs, m));
});

test("MIGRATION EQUIVALENCE: transfer/payback still excluded from outflow after migration", () => {
  const fs = floatState();
  const ps = migrateStateToPaise(fs);
  const m = "2026-10";
  const outflowPaise = ps.tx.filter((t) => core.inMonth(t, m) && core.OUT.includes(t.type)).reduce((a, t) => a + t.amount, 0);
  // Only expense (299.99) + investment (20000) are outflow; transfer & payback excluded.
  assert.equal(toRupees(outflowPaise), 20299.99);
});

test("MIGRATION preserves transaction count and ids (no data loss)", () => {
  const fs = floatState();
  const ps = migrateStateToPaise(fs);
  assert.equal(ps.tx.length, fs.tx.length);
  assert.deepEqual(ps.tx.map((t) => t.id).sort(), fs.tx.map((t) => t.id).sort());
  assert.equal(ps.moneyUnit, "paise");
});
