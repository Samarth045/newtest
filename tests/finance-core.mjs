// finance-core.mjs
// Pure, framework-free replication of My Money Control's financial calculation
// semantics as currently implemented in app.html. This is the regression baseline:
// it must match the live app's behavior exactly before any refactor.
//
// Money is currently stored as plain numbers (rupees, possibly fractional).
// These helpers take an explicit state object instead of relying on globals,
// so they are fully unit-testable in Node.

export const OUT = ["expense", "investment", "emi", "saving"];
export const TYPES = ["expense", "income", "investment", "emi", "saving", "transfer", "borrow", "payback"];
export const TRANSFERISH = ["transfer", "borrow", "payback"];

export const n = (x) => Number(x) || 0;

export function acc(state, id) {
  return (state.accounts || []).find((a) => a.id === id) || { name: "Unknown", opening: 0, minBalance: 0 };
}

export function inMonth(t, m) {
  return String(t.date || "").slice(0, 7) === m;
}

// Account balance: opening + income(into acct) - outflow(from acct)
// + transfers/borrow/payback credited to acct - those debited from acct.
export function balance(state, id) {
  let v = n(acc(state, id).opening);
  for (const t of state.tx || []) {
    if (t.type === "income" && t.account === id) v += n(t.amount);
    if (OUT.includes(t.type) && t.account === id) v -= n(t.amount);
    if (TRANSFERISH.includes(t.type)) {
      if (t.account === id) v -= n(t.amount);
      if (t.to === id) v += n(t.amount);
    }
  }
  return v;
}

export function sum(state, m, fn) {
  return (state.tx || []).filter((t) => inMonth(t, m) && fn(t)).reduce((a, t) => a + n(t.amount), 0);
}

export const income = (state, m) => sum(state, m, (t) => t.type === "income");
export const outflow = (state, m) => sum(state, m, (t) => OUT.includes(t.type));
export const invested = (state, m) => sum(state, m, (t) => t.type === "investment");
export const saved = (state, m) => sum(state, m, (t) => t.type === "saving");

export function netWorth(state) {
  return (state.accounts || []).reduce((a, x) => a + balance(state, x.id), 0);
}

// Savings rate as used on the dashboard: (income - outflow)/income, floored at 0.
export function savingsRate(state, m) {
  const inc = income(state, m);
  return inc > 0 ? Math.max(0, (inc - outflow(state, m)) / inc * 100) : 0;
}
