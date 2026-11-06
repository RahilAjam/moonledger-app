const CATEGORY_HINTS = [
  [/swiggy|zomato|food delivery|food order/, "Food delivery"],
  [/blinkit|zepto|bigbasket|grocery|groceries|vegetable|supermarket/, "Groceries"],
  [/rent|landlord/, "Rent"],
  [/netflix|spotify|subscription|prime video|hotstar|gym/, "Subscriptions"],
  [/auto|uber|ola|metro|bus|commute|fuel|petrol|cab/, "Commute"],
  [/movie|cinema|cafe|pub|outing|date night/, "Going out"],
  [/electricity|wifi|internet|phone bill|recharge|gas bill/, "Bills"],
  [/doctor|medicine|pharmacy|clinic/, "Health"],
  [/shopping|clothes|shoes/, "Shopping"],
  [/chai|tea|coffee|lunch|dinner|breakfast|snack|restaurant|meal/, "Food & drink"]
];
export function parseExpenseText(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  const amountMatch = text.match(/(?:₹|\binr\s*|\brs\.?\s*)(\d[\d,]*(?:\.\d{1,2})?)/i) || text.match(/(\d[\d,]*(?:\.\d{1,2})?)/);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[1].replaceAll(",", ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  let note = text.replace(amountMatch[0], "").replace(/\b(?:debited|paid|spent|purchase|at|on|for|via|upi|ref(?:erence)?|transaction|txn)\b/gi, " ").replace(/\b(?:rs\.?|inr)\b/gi, " ").replace(/\s+/g, " ").trim();
  note = note.replace(/[\s,;:.-]+$/, "").slice(0, 80);
  const lower = text.toLowerCase();
  const category = CATEGORY_HINTS.find(([pattern]) => pattern.test(lower))?.[1] || "Other";
  const method = /\bcash\b/i.test(lower) ? "Cash" : /\bcard\b/i.test(lower) ? "Card" : "UPI";
  return { amount, note, category, method };
}
export function escapeCsv(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
export function makeExpenseCsv(entries) {
  const rows = [["Date", "Amount (INR)", "Category", "Note", "Payment method"], ...entries.map((entry) => [new Date(entry.date).toISOString().slice(0, 10), Number(entry.amount), entry.category, entry.note, entry.method])];
  return "\uFEFF" + rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
}
