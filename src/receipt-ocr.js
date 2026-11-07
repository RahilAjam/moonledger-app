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
  const paymentContext = /payment\s+(?:successful|complete|completed|done)|successfully\s+(?:paid|sent|transferred)|(?:paid|sent|debited|transferred)\s+to|transaction\s+(?:successful|complete|completed)|payment details/i.test(String(text || ""));
  const excludedLine = /transaction\s*(?:id|no|number|ref|reference)|utr|rrn|phone|mobile|account|a\/c|date|time|balance/i;
  const candidates = lines.flatMap((line, index) => {
    const parsed = [...line.matchAll(moneyPattern)].map((match) => ({ amount: Number(match[1].replaceAll(",", "")), score: 10 }));
    const label = /(?:amount(?:\s+(?:paid|sent))?|total|paid|sent|debited|transferred)\s*[:\-]?\s*(?:₹|INR|Rs\.?|R\s)?\s*([0-9][\d,]*(?:\.\d{1,2})?)/i.exec(line);
    if (label && !excludedLine.test(line)) parsed.push({ amount: Number(label[1].replaceAll(",", "")), score: 8 });

    // Payment apps often render the rupee sign as a blank glyph in OCR. Accept
    // a short, standalone amount only when the surrounding screen confirms a
    // successful payment; never treat reference IDs or dates as amounts.
    const plain = /^(?:₹|INR|Rs\.?|R)?\s*([0-9]{1,6}(?:,[0-9]{3})*(?:\.\d{1,2})?)\s*$/i.exec(line);
    if (paymentContext && plain && !excludedLine.test(line)) {
      parsed.push({ amount: Number(plain[1].replaceAll(",", "")), score: 3 });
    }
    return parsed
      .filter(({ amount }) => Number.isFinite(amount) && amount > 0 && amount <= 1000000)
      .map((candidate) => ({ ...candidate, line, index }));
  });
  const chosen = candidates.sort((a, b) => b.score - a.score || a.index - b.index)[0];
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
    // Small phone screenshots make punctuation and currency marks hard to
    // recognize. Upscale them locally before OCR; the image never leaves the device.
    let input = file;
    if (typeof createImageBitmap === "function" && typeof document !== "undefined") {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(2, 2200 / Math.max(bitmap.width, bitmap.height));
      if (scale > 1.05) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.filter = "contrast(1.12)";
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        input = canvas;
      }
      bitmap.close();
    }
    const result = await worker.recognize(input, { rotateAuto: true });
    const details = parsePaymentScreenshotText(result.data.text);
    return details ? { ...details, text: result.data.text } : null;
  } finally {
    await worker.terminate();
  }
}
