// finance-core.test.mjs — regression baseline for My Money Control finance logic.
// Run with: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balance, income, outflow, invested, saved, netWorth, savingsRate, acc,
} from "./finance-core.mjs";

function baseState() {
  return {
    accounts: [
      { id: "hdfc", name: "HDFC", opening: 10000, minBalance: 20000 },
      { id: "cash", name: "Cash", opening: 500, minBalance: 0 },
      { id: "kotak", name: "Kotak", opening: 0, minBalance: 0 },
    ],
    tx: [],
  };
}

test("income adds to the destination account balance", () => {
  const s = baseState();
  s.tx.push({ id: "a", type: "income", amount: 5000, account: "hdfc", date: "2026-10-01" });
  assert.equal(balance(s, "hdfc"), 15000);
  assert.equal(income(s, "2026-10"), 5000);
});

test("expense reduces the source account and counts as outflow", () => {
  const s = baseState();
  s.tx.push({ id: "a", type: "expense", amount: 300, account: "cash", category: "Food", date: "2026-10-02" });
  assert.equal(balance(s, "cash"), 200);
  assert.equal(outflow(s, "2026-10"), 300);
});

test("transfer moves money between own accounts and is NOT an expense", () => {
  const s = baseState();
  s.tx.push({ id: "a", type: "transfer", amount: 2000, account: "hdfc", to: "cash", date: "2026-10-03" });
  assert.equal(balance(s, "hdfc"), 8000, "source debited");
  assert.equal(balance(s, "cash"), 2500, "destination credited");
  assert.equal(outflow(s, "2026-10"), 0, "transfer must not inflate outflow");
  assert.equal(income(s, "2026-10"), 0, "transfer must not inflate income");
  assert.equal(netWorth(s), 10500, "net worth unchanged by internal transfer");
});

test("borrow credits the receiving account without becoming income", () => {
  const s = baseState();
  // Borrow money INTO cash from an external party (modeled account->to).
  s.tx.push({ id: "a", type: "borrow", amount: 1000, account: "kotak", to: "cash", date: "2026-10-04" });
  assert.equal(income(s, "2026-10"), 0, "borrow is not income");
  assert.equal(outflow(s, "2026-10"), 0, "borrow is not outflow");
  assert.equal(balance(s, "cash"), 1500);
  assert.equal(balance(s, "kotak"), -1000);
});

test("payback moves money and does not double-count as outflow", () => {
  const s = baseState();
  s.tx.push({ id: "a", type: "payback", amount: 1000, account: "cash", to: "kotak", date: "2026-10-05" });
  assert.equal(outflow(s, "2026-10"), 0, "payback is a transfer-like move, not outflow");
  assert.equal(balance(s, "cash"), -500);
  assert.equal(balance(s, "kotak"), 1000);
});

test("THREE identical transactions all count independently (no dedupe)", () => {
  const s = baseState();
  s.tx.push({ id: "f1", type: "expense", amount: 100, account: "cash", category: "Food", description: "Food", date: "2026-10-06" });
  s.tx.push({ id: "f2", type: "expense", amount: 100, account: "cash", category: "Food", description: "Food", date: "2026-10-06" });
  s.tx.push({ id: "f3", type: "expense", amount: 100, account: "cash", category: "Food", description: "Food", date: "2026-10-06" });
  assert.equal(outflow(s, "2026-10"), 300, "all three identical ₹100 Food must be counted");
  assert.equal(balance(s, "cash"), 200);
});

test("adding a transaction never changes earlier transactions (no overwrite)", () => {
  const s = baseState();
  const t1 = { id: "x1", type: "expense", amount: 100, account: "cash", category: "Food", date: "2026-10-07" };
  s.tx.push(t1);
  const snapshotT1 = JSON.stringify(t1);
  s.tx.push({ id: "x2", type: "expense", amount: 250, account: "cash", category: "Transport", date: "2026-10-07" });
  assert.equal(JSON.stringify(s.tx.find((t) => t.id === "x1")), snapshotT1, "tx x1 must be untouched");
  assert.equal(s.tx.length, 2);
  assert.equal(outflow(s, "2026-10"), 350);
});

test("investment and saving count as outflow but are categorized", () => {
  const s = baseState();
  s.tx.push({ id: "i", type: "investment", amount: 20000, account: "hdfc", category: "MF SIP", date: "2026-10-08" });
  s.tx.push({ id: "v", type: "saving", amount: 2000, account: "hdfc", category: "Emergency Fund", date: "2026-10-08" });
  assert.equal(invested(s, "2026-10"), 20000);
  assert.equal(saved(s, "2026-10"), 2000);
  assert.equal(outflow(s, "2026-10"), 22000, "investment + saving are part of outflow");
  assert.equal(income(s, "2026-10"), 0);
});

test("month filtering isolates figures per month", () => {
  const s = baseState();
  s.tx.push({ id: "a", type: "income", amount: 5000, account: "hdfc", date: "2026-09-30" });
  s.tx.push({ id: "b", type: "income", amount: 7000, account: "hdfc", date: "2026-10-01" });
  assert.equal(income(s, "2026-09"), 5000);
  assert.equal(income(s, "2026-10"), 7000);
});

test("savings rate = (income - outflow)/income, floored at 0", () => {
  const s = baseState();
  s.tx.push({ id: "a", type: "income", amount: 10000, account: "hdfc", date: "2026-10-01" });
  s.tx.push({ id: "b", type: "expense", amount: 4000, account: "hdfc", category: "Rent", date: "2026-10-02" });
  assert.equal(Math.round(savingsRate(s, "2026-10")), 60);
  // Overspend -> floored at 0, never negative.
  s.tx.push({ id: "c", type: "expense", amount: 20000, account: "hdfc", category: "Shopping", date: "2026-10-03" });
  assert.equal(savingsRate(s, "2026-10"), 0);
});

test("unknown account id is handled without crashing", () => {
  const s = baseState();
  assert.equal(acc(s, "ghost").name, "Unknown");
  assert.equal(balance(s, "ghost"), 0);
});
