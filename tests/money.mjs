// money.mjs — integer-paise money handling for My Money Control.
//
// Rationale: JavaScript floats cannot represent decimal rupees exactly
// (0.1 + 0.2 !== 0.3). For a finance app, amounts are stored as INTEGER PAISE
// (1 rupee = 100 paise) and converted to/from rupees only at the UI edge.
//
// All arithmetic (balances, sums) is done on integers, which is exact.

// Convert a user-entered rupee value (string or number, possibly fractional)
// into integer paise. Rounds to nearest paise to absorb float noise.
export function toPaise(rupees) {
  const num = typeof rupees === "string" ? parseFloat(rupees) : Number(rupees);
  if (!Number.isFinite(num)) return 0;
  // Scale then round to avoid 19.99*100 = 1998.9999999 style errors.
  return Math.round((num + Number.EPSILON) * 100);
}

// Convert integer paise back to a rupee number (for display/export).
export function toRupees(paise) {
  return (Number(paise) || 0) / 100;
}

// Format integer paise as an Indian-locale currency string.
// Mirrors the app's existing display: rupee symbol + grouped integer rupees.
export function formatPaise(paise, { withDecimals = false } = {}) {
  const rupees = toRupees(paise);
  if (withDecimals) {
    return "₹" + rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return "₹" + Math.round(rupees).toLocaleString("en-IN");
}

// Validate an integer-paise amount: must be a finite integer > 0.
export function isValidPaise(paise) {
  return Number.isInteger(paise) && paise > 0;
}

// Migrate a single transaction's amount from float rupees to integer paise.
// Idempotent-safe when guarded by schemaVersion (caller decides when to run).
export function migrateTxAmount(tx) {
  return { ...tx, amount: toPaise(tx.amount) };
}

// Migrate account opening/minBalance fields to paise.
export function migrateAccount(a) {
  return {
    ...a,
    opening: toPaise(a.opening),
    minBalance: toPaise(a.minBalance),
  };
}

// Full-state migration from float-rupee schema to integer-paise schema.
// Returns a NEW state object; does not mutate the input (safe for validation).
export function migrateStateToPaise(state) {
  return {
    ...state,
    accounts: (state.accounts || []).map(migrateAccount),
    tx: (state.tx || []).map(migrateTxAmount),
    budgets: migrateBudgets(state.budgets),
    goals: (state.goals || []).map((g) => ({ ...g, target: toPaise(g.target), saved: toPaise(g.saved) })),
    recurring: (state.recurring || []).map((r) => ({ ...r, amount: toPaise(r.amount) })),
    moneyUnit: "paise",
  };
}

function migrateBudgets(budgets) {
  if (!budgets || typeof budgets !== "object") return {};
  const out = {};
  for (const month of Object.keys(budgets)) {
    out[month] = (budgets[month] || []).map((b) => ({ ...b, amount: toPaise(b.amount) }));
  }
  return out;
}
