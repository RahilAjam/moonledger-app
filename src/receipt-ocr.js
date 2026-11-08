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
    const shortNamed = source.match(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i);
    const shortMonthDay = source.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/i);
    if (numeric) {
      year = Number(numeric[3].length === 2 ? "20" + numeric[3] : numeric[3]);
      month = Number(numeric[2]);
      day = Number(numeric[1]);
    } else if (shortNamed) {
      const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      year = new Date().getFullYear();
      month = months.indexOf(shortNamed[2].slice(0, 3).toLowerCase()) + 1;
      day = Number(shortNamed[1]);
      // A receipt dated well ahead of today is most likely from last year.
      const candidate = new Date(year, month - 1, day, 12);
      const today = new Date();
      if (candidate.getTime() - today.getTime() > 31 * 86400000) year -= 1;
    } else if (shortMonthDay) {
      const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      year = new Date().getFullYear();
      month = months.indexOf(shortMonthDay[1].slice(0, 3).toLowerCase()) + 1;
      day = Number(shortMonthDay[2]);
      const candidate = new Date(year, month - 1, day, 12);
      if (candidate.getTime() - new Date().getTime() > 31 * 86400000) year -= 1;
    } else return new Date().toISOString();
  }
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return new Date().toISOString();
  return date.toISOString();
}

export function parsePaymentScreenshotText(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const source = String(text || "");
  if (/payment\s+(?:failed|declined|pending)|transaction\s+(?:failed|declined|pending)|failed\s+to\s+pay/i.test(source)) return null;
  const provider = /\bnavi\b/i.test(source) ? "Navi"
    : /phonepe|bharat connect/i.test(source) ? "PhonePe"
      : /super\.?money|supermoney/i.test(source) ? "super.money"
        : /google\s*pay|gpay|google transaction/i.test(source) ? "Google Pay"
          : /paytm/i.test(source) ? "Paytm" : "UPI";
  const paymentContext = /payment\s+(?:successful|complete|completed|done)|paid\s+successfully|successfully\s+(?:paid|sent|transferred)|(?:paid|sent|debited|transferred)\s+to|transaction\s+(?:successful|complete|completed)|bill\s+payment\s+successful/i.test(source);
  const excludedLine = /transaction\s*(?:id|no|number|ref|reference)|upi\s*(?:txn|ref|transaction|reference)|utr|rrn|phone|mobile|account|a\/c|date|time|balance|banking name|bill date/i;
  const candidates = [];
  const amountPattern = /(?:₹\s*|\bINR\s*|\bRs\.?\s*)(\d[\d,]*(?:\.\d{1,2})?)/gi;
  const lineAmounts = (line) => [...line.matchAll(amountPattern)].map((match) => ({ amount: Number(match[1].replaceAll(",", "")), index: match.index, raw: match[0] }));
  const pushCandidate = (amount, line, index, score) => {
    if (Number.isFinite(amount) && amount > 0 && amount <= 1000000 && !excludedLine.test(line)) candidates.push({ amount, line, index, score });
  };
  lines.forEach((line, index) => {
    if (/cashback|cash\s*back|available balance|closing balance|account balance|transaction\s*(?:id|no|number|ref|reference)|\butr\b|\brrn\b|phone|mobile|account|a\/c|date|time|balance/i.test(line)) return;
    for (const found of lineAmounts(line)) {
      const left = line.slice(0, found.index).toLowerCase();
      let score = 12; // Explicit currency amount.
      if (/total\s+amount|amount\s+paid|paid\s+amount|payment\s+amount/.test(line.toLowerCase())) score = 40;
      else if (/bill\s+amount/.test(line.toLowerCase())) score = 8;
      else if (/platform\s+fee|convenience\s+fee|processing\s+fee/.test(line.toLowerCase())) score = 1;
      else if (/cashback|reward|saved/.test(line.toLowerCase())) score = 0;
      else if (/debited\s+from|paid\s+successfully|payment\s+successful|payment\s+of/.test(line.toLowerCase())) score = 18;
      // A receipt's main amount is commonly shown immediately below its
      // success label, with no text on the same line.
      else if (index > 0 && /success|completed|payment successful/i.test(lines.slice(Math.max(0, index - 2), index).join(" "))) score = 20;
      // Merchant/utility rows can show the amount inline; keep these useful,
      // but below semantically labelled totals.
      if (/total amount/.test(left)) score = 40;
      pushCandidate(found.amount, line, index, score);
    }
    const label = /(?:amount(?:\s+(?:paid|sent))?|total|paid|sent|debited|transferred)\s*[:\-]?\s*(?:₹|INR|Rs\.?|R\s)?\s*([0-9][\d,]*(?:\.\d{1,2})?)/i.exec(line);
    if (label) {
      const normalizedLine = line.toLowerCase();
      const score = /total\s+amount|amount\s+paid|paid\s+amount/.test(normalizedLine) ? 40 : 18;
      pushCandidate(Number(label[1].replaceAll(",", "")), line, index, score);
    }

    // OCR sometimes loses the ₹ glyph from the large amount. Only allow a
    // short, isolated number on a confirmed payment screen; date/reference
    // rows are excluded above and identifier-like long numbers never qualify.
    const plain = /^(?:₹|INR|Rs\.?|R)?\s*([0-9]{1,6}(?:,[0-9]{3})*(?:\.\d{1,2})?)\s*$/i.exec(line);
    if (paymentContext && plain && !excludedLine.test(line)) pushCandidate(Number(plain[1].replaceAll(",", "")), line, index, 3);
  });
  const chosen = candidates.sort((a, b) => b.score - a.score || a.index - b.index)[0];
  if (!chosen) return null;

  const merchantPattern = /(?:paid\s+to|sent\s+to|transferred\s+to|paid\s+at|merchant|^to(?:\s*:|\s+))/i;
  const merchantIndex = lines.findIndex((line) => merchantPattern.test(line));
  const merchantInline = merchantIndex < 0 ? "" : lines[merchantIndex].match(/(?:paid\s+to|sent\s+to|transferred\s+to|paid\s+at|merchant|^to(?:\s*:|\s+))\s*(.+)/i)?.[1] || "";
  const merchantNextLine = merchantIndex >= 0 && !merchantInline.trim()
    ? lines.slice(merchantIndex + 1).find((line) => !/^(?:banking name|upi id|transaction|date|time|\d|₹|rs\b|inr\b|completed|payment of)/i.test(line)) || ""
    : "";
  let merchant = String(merchantInline || merchantNextLine).replace(/\b(?:upi|payment successful|successful|completed)\b.*$/i, "").replace(/[|•·].*$/, "").trim().slice(0, 70);
  if (!merchant && /bill\s+payment|electricity\s+bill/i.test(source)) {
    const billHeading = lines.findIndex((line) => /electricity\s+bill\s+paid|bill\s+payment\s+successful/i.test(line));
    const payeeLine = lines.slice(Math.max(0, billHeading + 1)).find((line) =>
      /[A-Za-z]{3}/.test(line) &&
      !/^(?:electricity\s+bill\s+paid|bill\s+payment\s+successful)$/i.test(line) &&
      !/bill details|payment details|bill amount|total amount|platform fee|transaction|customer name|account|utr|date|time/i.test(line) &&
      !/^\d[\d\s-]{7,}$/.test(line)
    ) || "";
    merchant = payeeLine.replace(/(?:₹|INR|Rs\.?)[\s\d,.]*/gi, "").replace(/\s+\d[\d\s-]*$/, "").trim().slice(0, 70);
  }
  const hints = (merchant || chosen.line) + " " + lines.join(" ");
  const inferred = parseExpenseText(String(chosen.amount) + " " + hints);
  const category = /electricity|utility|bill payment|bescom/i.test(source) ? "Bills" : inferred?.category || "Other";
  return {
    amount: chosen.amount,
    category,
    method: "UPI",
    date: parseSharedDate(text),
    merchant,
    note: merchant,
    provider,
    confidence: chosen.score
  };
}

export async function readPaymentScreenshot(file, onProgress = () => {}) {
  if (!(file instanceof Blob)) throw new Error("Share a payment screenshot in PNG, JPG, or WebP format.");
  if (file.size > 12 * 1024 * 1024) throw new Error("That image is too large. Share a screenshot under 12 MB.");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, { logger: (event) => {
    if (event.status === "recognizing text") onProgress({ status: event.status, progress: Math.round((event.progress || 0) * 100) });
    else onProgress({ status: event.status, progress: null });
  } });
  try {
    // Verify the actual image signature too. Some Android share providers
    // label a valid JPEG as application/octet-stream.
    let image = file;
    if (!file.type.startsWith("image/")) {
      const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
      const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
      const isWebp = String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
      if (!isPng && !isJpeg && !isWebp) throw new Error("The shared file isn’t a readable image. Try sharing the receipt image itself.");
      image = new Blob([file], { type: isPng ? "image/png" : isWebp ? "image/webp" : "image/jpeg" });
    }

    // Read the whole receipt and focused, enlarged regions. Full-page OCR
    // preserves context for separating the payment amount from IDs; enlarged
    // header regions help on tall Android UPI receipts where text is tiny.
    let fullImages = [file];
    if (typeof createImageBitmap === "function" && typeof document !== "undefined") {
      const bitmap = await createImageBitmap(image);
      const scale = Math.min(1.7, 3200 / Math.max(bitmap.width, bitmap.height));
      const makeCanvas = (filter, top = 0, height = bitmap.height) => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.filter = filter;
        context.drawImage(bitmap, 0, top, bitmap.width, height, 0, 0, canvas.width, canvas.height);
        return canvas;
      };
      const enhanced = makeCanvas("grayscale(1) contrast(1.65) brightness(1.12)");
      const thresholded = makeCanvas("grayscale(1) contrast(3) brightness(1.2)");
      // A hard black/white version often helps OCR on white receipt text over
      // dark UPI screens. Keep the original and enhanced forms for logo/color
      // layouts where thresholding can erase useful strokes.
      const thresholdContext = thresholded.getContext("2d", { willReadFrequently: true });
      const pixels = thresholdContext.getImageData(0, 0, thresholded.width, thresholded.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const value = pixels.data[i] > 118 ? 255 : 0;
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
      }
      thresholdContext.putImageData(pixels, 0, 0);
      const header = makeCanvas("grayscale(1) contrast(1.8) brightness(1.1)", 0, Math.round(bitmap.height * 0.56));
      const headerThresholded = makeCanvas("grayscale(1) contrast(3) brightness(1.2)", 0, Math.round(bitmap.height * 0.56));
      fullImages = [enhanced, thresholded, header, headerThresholded];
      bitmap.close();
    }
    const reads = [];
    for (const [index, sourceImage] of fullImages.entries()) {
      const modes = index >= 3 ? ["6"] : ["11", "6"];
      for (const mode of modes) {
        await worker.setParameters({ tessedit_pageseg_mode: mode, tessedit_char_whitelist: "" });
        reads.push((await worker.recognize(sourceImage, { rotateAuto: true })).data.text);
      }
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
    // If OCR drops only the currency glyph, accept a short standalone number
    // from a full-image pass when the same whole image independently contains
    // the payment confirmation context. Long dates and IDs are never eligible.
    const confirmedPayment = /(?:paid\s+to|sent\s+to|transferred\s+to|payment\s+(?:successful|complete|completed)|successfully\s+(?:paid|sent))/i.test(recognizedText);
    const hasStandaloneAmount = reads.some((read) => read.split(/\r?\n/).some((line) => /^(?:₹|INR|Rs\.?|R)?\s*[0-9]{1,6}(?:\.\d{1,2})?\s*$/i.test(line.trim())));
    if (chosen && chosen.count === 1 && chosen.score < 8 && !(confirmedPayment && hasStandaloneAmount && chosen.score >= 3)) return null;
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
