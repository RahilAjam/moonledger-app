import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { hasPlus, planLabel } from "../src/plan.js";
import { getArchiveBoundary, getArchiveSummary, getDaysUntilArchive, getVisibleExpenses, isArchivedExpense } from "../src/archive.js";
import { makeExpenseCsv } from "../src/feature-tools.js";

test("no plan claim defaults to Free", () => {
  assert.equal(hasPlus({}), false);
  assert.equal(planLabel({}), "free");
});

test("all gifted and paid plans grant Plus; free does not", () => {
  for (const plan of ["plus", "lifetime", "friend", "owner"]) assert.equal(hasPlus({ plan }), true);
  assert.equal(hasPlus({ plan: "free" }), false);
});

test("expired or invalid expiry falls back to Free", () => {
  assert.equal(hasPlus({ plan: "friend", planUntil: 999 }, 1000), false);
  assert.equal(hasPlus({ plan: "plus", planUntil: "not-a-date" }), false);
  assert.equal(hasPlus({ plan: "plus", planUntil: 1000 }, 999), true);
});

test("rolling archive window includes the exact boundary date", () => {
  const now = new Date(2026, 10, 7, 18);
  const boundary = getArchiveBoundary(now);
  assert.equal(boundary, "2025-11-07");
  assert.equal(isArchivedExpense({ date: "2025-11-07T02:00:00.000Z" }, now), false);
  assert.equal(isArchivedExpense({ date: "2025-11-06" }, now), true);
});

test("archive summary counts and totals hidden expenses without mutating them", () => {
  const rows = [{ date: "2024-12-01", amount: 25 }, { date: "2026-01-01", amount: 10 }];
  assert.deepEqual(getArchiveSummary(rows, new Date(2026, 10, 7)), { count: 1, total: 25, boundary: "2025-11-07" });
  assert.equal(rows[0].archived, undefined);
  assert.equal(getVisibleExpenses(rows, false, new Date(2026, 10, 7)).length, 1);
  assert.equal(getVisibleExpenses(rows, true, new Date(2026, 10, 7)).length, 2);
});

test("archive calculations follow local calendar dates across a month boundary", () => {
  const now = new Date(2026, 2, 1, 1);
  assert.equal(getArchiveBoundary(now), "2025-03-01");
  assert.equal(getDaysUntilArchive({ date: "2025-03-15" }, now), 14);
});

test("ISO dates created from local noon retain the intended calendar day in UTC+14", () => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `import { localDateKey, isArchivedExpense } from './src/archive.js'; const stored = new Date(2025, 10, 7, 12).toISOString(); console.log(localDateKey(stored) + '|' + isArchivedExpense({date: stored}, new Date(2026, 10, 7, 18)));`], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, TZ: "Pacific/Kiritimati" }
  }).trim();
  assert.equal(output, "2025-11-07|false");
});

test("expense CSV keeps old archived and recent expenses together", () => {
  const csv = makeExpenseCsv([
    { date: "2024-01-02", amount: 40, category: "Food & drink", note: "Old chai", method: "Cash" },
    { date: "2026-11-07", amount: 80, category: "Commute", note: "Auto", method: "UPI" }
  ]);
  assert.match(csv, /2024-01-02,40,Food & drink,Old chai,Cash/);
  assert.match(csv, /2026-11-07,80,Commute,Auto,UPI/);
});
