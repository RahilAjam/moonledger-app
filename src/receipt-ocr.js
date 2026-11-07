import { parseExpenseText } from "./feature-tools.js";

function parseSharedDate(text) {
  const numeric = String(text).match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (!numeric) return new Date().toISOString();
  const year = Number(numeric[3].length === 2 ? "20" + numeric[3] : numeric[3]);
  const month = Number(numeric[2]);
  const day = Number(numeric[1]);
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return new Date().toISOString();
  return date.toISOString();
}

export function parsePaymentScreenshotText(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const moneyPattern = /(?:₹\s*|\bINR\s*|\bRs\.?\s*)(\d[\d,]*(?:\.\d{1,2})?)/gi;
  const prioritized = lines.filter((line) => /paid|sent|debited|payment|amount|transferred/i.test(line));
  const candidates = [...prioritized, ...lines].flatMap((line) => {
    const amounts = [...line.matchAll(moneyPattern)].map((match) => Number(match[1].replaceAll(",", "")));
    return amounts.filter((amount) => Number.isFinite(amount) && amount > 0).map((amount) => ({ amount, line }));
  });
  const chosen = candidates[0];
  if (!chosen) return null;

  const merchantLine = lines.find((line) => /(?:paid\s+to|sent\s+to|transferred\s+to|paid\s+at|merchant)\s*[:\-]?\s*\S/i.test(line));
  const merchantMatch = merchantLine?.match(/(?:paid\s+to|sent\s+to|transferred\s+to|paid\s+at|merchant)\s*[:\-]?\s*(.+)/i);
  const merchant = String(merchantMatch?.[1] || "").replace(/\b(?:upi|payment successful|successful)\b.*$/i, "").replace(/[|•·].*$/, "").trim().slice(0, 55);
  const hints = (merchant || chosen.line) + " " + lines.join(" ");
  const inferred = parseExpenseText(String(chosen.amount) + " " + hints);
  return {
    amount: chosen.amount,
    category: inferred?.category || "Other",
    method: "UPI",
    date: parseSharedDate(text),
    merchant,
    note: merchant
  };
}

export async function readPaymentScreenshot(file, onProgress = () => {}) {
  if (!(file instanceof Blob) || !file.type.startsWith("image/")) throw new Error("Share a payment screenshot in PNG, JPG, or WebP format.");
  if (file.size > 12 * 1024 * 1024) throw new Error("That image is too large. Share a screenshot under 12 MB.");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, { logger: (event) => { if (event.status === "recognizing text") onProgress(Math.round((event.progress || 0) * 100)); } });
  try {
    const result = await worker.recognize(file, { rotateAuto: true });
    const details = parsePaymentScreenshotText(result.data.text);
    return details ? { ...details, text: result.data.text } : null;
  } finally {
    await worker.terminate();
  }
}
