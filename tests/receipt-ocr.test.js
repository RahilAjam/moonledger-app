import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePaymentScreenshotText } from "../src/receipt-ocr.js";

test("extracts UPI amount, merchant, category and date from OCR text", () => {
  const parsed = parsePaymentScreenshotText("Payment successful\nPaid to Swiggy\n₹ 250.00\n07/11/2026");
  assert.equal(parsed.amount, 250);
  assert.equal(parsed.merchant, "Swiggy");
  assert.equal(parsed.category, "Food delivery");
  assert.equal(parsed.method, "UPI");
  assert.equal(parsed.date, new Date(2026, 10, 7, 12).toISOString());
});

test("does not guess a payment amount when currency is missing", () => {
  assert.equal(parsePaymentScreenshotText("Payment successful\nPaid to Swiggy\nTransaction ID 1246"), null);
});

test("reads a standalone amount when OCR drops the rupee symbol on a payment confirmation", () => {
  const parsed = parsePaymentScreenshotText("Payment successful\nPaid to Swiggy\n250.00\nTransaction ID 839201748512");
  assert.equal(parsed.amount, 250);
  assert.equal(parsed.merchant, "Swiggy");
});

test("prefers a labeled payment amount over a reference number", () => {
  const parsed = parsePaymentScreenshotText("Payment successful\nAmount paid: 1,250\nUTR 982384719234");
  assert.equal(parsed.amount, 1250);
});

test("ignores invalid dates and safely falls back to today", () => {
  const parsed = parsePaymentScreenshotText("Paid to Auto\nRs. 60\n31/02/2026");
  assert.equal(parsed.amount, 60);
  assert.equal(parsed.merchant, "Auto");
  assert.notEqual(parsed.date, new Date(2026, 2, 3, 12).toISOString());
});
