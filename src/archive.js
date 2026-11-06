export function localDateKey(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    const dateOnly = value.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (dateOnly) return dateOnly[1];
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function atLocalNoon(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function getArchiveBoundary(now = new Date()) {
  const boundary = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  boundary.setFullYear(boundary.getFullYear() - 1);
  return localDateKey(boundary);
}

export function isArchivedExpense(expense, now = new Date()) {
  const key = localDateKey(expense?.date);
  return Boolean(key && key < getArchiveBoundary(now));
}

export function getArchiveSummary(expenses, now = new Date()) {
  const boundary = getArchiveBoundary(now);
  const archived = expenses.filter((expense) => {
    const key = localDateKey(expense?.date);
    return Boolean(key && key < boundary);
  });
  return { count: archived.length, total: archived.reduce((sum, item) => sum + Number(item.amount || 0), 0), boundary };
}

export function getDaysUntilArchive(expense, now = new Date()) {
  const key = localDateKey(expense?.date);
  if (!key) return null;
  const expiry = atLocalNoon(key);
  expiry.setFullYear(expiry.getFullYear() + 1);
  const today = atLocalNoon(localDateKey(now));
  return Math.round((expiry - today) / 86400000);
}

export function getOldestUpcomingArchive(expenses, now = new Date()) {
  const candidates = expenses.map((expense) => ({ expense, days: getDaysUntilArchive(expense, now) }))
    .filter(({ days }) => days !== null && days > 0 && days <= 30)
    .sort((a, b) => a.days - b.days);
  return candidates[0] || null;
}

export function getVisibleExpenses(expenses, isPlus, now = new Date()) {
  return isPlus ? expenses : expenses.filter((expense) => !isArchivedExpense(expense, now));
}
