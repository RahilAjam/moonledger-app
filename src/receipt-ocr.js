import { parseExpenseText } from "./feature-tools.js";

function parseSharedDate(text) {
  const source = String(text);
  const named = source.match(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\b/i)
    || source.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i);
  let year, month, day;
  if (named) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const monthText = named[2] && /^\d+$/.test(named[1]) ? named[2] : named[1];
    day = Number(named[2] && /^\d+$/.test(named[1]) ? named[1] : named[2]);
    year = Number(named[3]);
    month = months.indexOf(monthText.slice(0, 3).toLowerCase()) + 1;
  } else {
    const numeric = source.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
    if (!numeric) return new Date().toISOString();
    year = Number(numeric[3].length === 2 ? "20" + numeric[3] : numeric[3]);
    month = Number(numeric[2]);
    day = Number(numeric[1]);
  }
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
    if (/cashback|cash\s*back|available balance|closing balance|account balance|banking name|transaction\s*(?:id|no|number|ref|reference)|\butr\b|\brrn\b|phone|mobile|account|a\/c|date|time|balance/i.test(line)) return [];
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

  const merchantIndex = lines.findIndex((line) => /(?:paid\s+to|sent\s+to|transferred\s+to|paid\s+at|merchant)/i.test(line));
  const merchantInline = merchantIndex < 0 ? "" : lines[merchantIndex].match(/(?:paid\s+to|sent\s+to|transferred\s+to|paid\s+at|merchant)\s*[:\-]?\s*(.+)/i)?.[1] || "";
  const merchantNextLine = merchantIndex >= 0 && !merchantInline.trim()
    ? lines.slice(merchantIndex + 1).find((line) => !/^(?:banking name|upi id|transaction|date|time|\d|₹|rs\b|inr\b)/i.test(line)) || ""
    : "";
  const merchant = String(merchantInline || merchantNextLine).replace(/\b(?:upi|payment successful|successful)\b.*$/i, "").replace(/[|•·].*$/, "").trim().slice(0, 55);
  const hints = (merchant || chosen.line) + " " + lines.join(" ");
  const inferred = parseExpenseText(String(chosen.amount) + " " + hints);
  return {
    amount: chosen.amount,
    category: inferred?.category || "Other",
    method: "UPI",
    date: parseSharedDate(text),
    merchant,
    note: merchant,
    confidence: chosen.score
  };
}

export async function readPaymentScreenshot(file, onProgress = () => {}) {
  if (!(file instanceof Blob) || !file.type.startsWith("image/")) throw new Error("Share a payment screenshot in PNG, JPG, or WebP format.");
  if (file.size > 12 * 1024 * 1024) throw new Error("That image is too large. Share a screenshot under 12 MB.");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, { logger: (event) => { if (event.status === "recognizing text") onProgress(Math.round((event.progress || 0) * 100)); } });
  try {
    // Phone receipts often put the amount in a small block surrounded by a
    // large dark/blank canvas. Read the full image and focused regions locally.
    let input = file;
    let amountRegion = null;
    let detailsRegion = null;
    if (typeof createImageBitmap === "function" && typeof document !== "undefined") {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(2, 2600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.filter = "grayscale(1) contrast(1.2)";
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const crop = (x, y, width, height) => {
        const region = document.createElement("canvas");
        region.width = Math.round(canvas.width * width);
        region.height = Math.round(canvas.height * height);
        const regionContext = region.getContext("2d", { willReadFrequently: true });
        regionContext.filter = "contrast(1.35)";
        regionContext.drawImage(canvas, Math.round(canvas.width * x), Math.round(canvas.height * y), region.width, region.height, 0, 0, region.width, region.height);
        return region;
      };
      input = canvas;
      // GPay-style success receipts place the amount near the top and payment
      // metadata in a separate block lower down. These crops improve small text.
      amountRegion = crop(0.16, 0.16, 0.68, 0.34);
      detailsRegion = crop(0.08, 0.48, 0.84, 0.34);
      bitmap.close();
    }
    const standard = await worker.recognize(input, { rotateAuto: true });
    await worker.setParameters({ tessedit_pageseg_mode: "11" });
    const reads = [standard.data.text];
    if (detailsRegion) reads.push((await worker.recognize(detailsRegion)).data.text);
    if (amountRegion) {
      await worker.setParameters({ tessedit_pageseg_mode: "7", tessedit_char_whitelist: "0123456789₹.,INR" });
      reads.push((await worker.recognize(amountRegion)).data.text);
    } else {
      const sparse = await worker.recognize(input, { rotateAuto: true });
      reads.push(sparse.data.text);
    }
    const recognizedText = reads.filter(Boolean).join("\n");
    const passDetails = reads.map(parsePaymentScreenshotText).filter(Boolean);
    const combined = parsePaymentScreenshotText(recognizedText);
    if (!passDetails.length && !combined) return null;

    // Prefer an amount repeated by independent passes. A single explicit
    // currency amount is also safe; conflicting equally strong reads are not.
    const groups = new Map();
    for (const detail of passDetails) {
      const group = groups.get(detail.amount) || { amount: detail.amount, count: 0, score: 0, detail };
      group.count += 1;
      group.score += detail.confidence;
      if (detail.confidence > group.detail.confidence) group.detail = detail;
      groups.set(detail.amount, group);
    }
    const ranked = [...groups.values()].sort((a, b) => b.count - a.count || b.score - a.score);
    let chosen = ranked[0];
    if (ranked.length > 1 && ranked[0].count === ranked[1].count && ranked[0].score - ranked[1].score < 4) return null;
    if (chosen && chosen.count === 1 && chosen.score < 8) return null;
    if (!chosen && combined) {
      if (combined.confidence < 8) return null;
      chosen = { amount: combined.amount, score: combined.confidence, detail: combined };
    }
    const details = combined || chosen?.detail;
    return details && chosen ? { ...details, amount: chosen.amount, confidence: chosen.score, text: recognizedText } : null;
  } finally {
    await worker.terminate();
  }
}
