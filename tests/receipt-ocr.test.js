import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePaymentScreenshotText, sortOcrItems } from "../src/receipt-ocr.js";

test("orders screenshot OCR boxes top-to-bottom and left-to-right", () => {
  const box = (x, y, text) => ({ text, score: 0.9, poly: [
    { x, y }, { x: x + 20, y }, { x: x + 20, y: y + 10 }, { x, y: y + 10 }
  ] });
  const lines = sortOcrItems([
    box(180, 50, "right"), box(10, 51, "left"), box(12, 12, "top"), box(5, 100, "bottom")
  ]);
  assert.deepEqual(lines.map((line) => line.text), ["top", "left", "right", "bottom"]);
});

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

test("does not turn a failed or pending payment screenshot into an expense draft", () => {
  assert.equal(parsePaymentScreenshotText("Payment failed\n₹500\nTo Shop"), null);
  assert.equal(parsePaymentScreenshotText("Transaction pending\n₹500\nTo Shop"), null);
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

test("reads a Google Pay style tall receipt with the amount and recipient on separate lines", () => {
  const parsed = parsePaymentScreenshotText("✓\n₹32\nPaid to\nNagarathnama\nBanking name: Nagarathnama\n7 November 2026, 7:34pm\nPowered by UPI");
  assert.equal(parsed.amount, 32);
  assert.equal(parsed.merchant, "Nagarathnama");
  assert.equal(parsed.date, new Date(2026, 10, 7, 12).toISOString());
});

test("does not choose cashback or balance figures instead of the payment", () => {
  const parsed = parsePaymentScreenshotText("Payment successful\nPaid to Shop\n₹32\nCashback ₹5\nAvailable balance ₹900");
  assert.equal(parsed.amount, 32);
});

test("ignores invalid dates and safely falls back to today", () => {
  const parsed = parsePaymentScreenshotText("Paid to Auto\nRs. 60\n31/02/2026");
  assert.equal(parsed.amount, 60);
  assert.equal(parsed.merchant, "Auto");
  assert.notEqual(parsed.date, new Date(2026, 2, 3, 12).toISOString());
});

test("reads Paytm's labeled recipient and ignores the UPI reference", () => {
  const parsed = parsePaymentScreenshotText("Paytm\nPaid Successfully\n₹30\nRupees Thirty Only\nTo: Google Play\nUPI Ref No: 617408652168\n08:08 PM, 03 Nov 2026");
  assert.equal(parsed.amount, 30);
  assert.equal(parsed.merchant, "Google Play");
  assert.equal(parsed.provider, "Paytm");
  assert.equal(parsed.date, new Date(2026, 10, 3, 12).toISOString());
});

test("reads Google Pay amount and person recipient while ignoring transaction IDs", () => {
  const parsed = parsePaymentScreenshotText("Google Pay\nTo Nagarathnama\n₹30\nCompleted\nPayment of ₹30 completed\nUPI transaction ID 631140650850\n7 Nov 2026, 9:40 pm");
  assert.equal(parsed.amount, 30);
  assert.equal(parsed.merchant, "Nagarathnama");
  assert.equal(parsed.provider, "Google Pay");
  assert.equal(parsed.date, new Date(2026, 10, 7, 12).toISOString());
});

test("chooses PhonePe's total amount over bill amount, fee, and UTR", () => {
  const parsed = parsePaymentScreenshotText("PhonePe\nBill Payment Successful\nElectricity bill paid\nBangalore Electricity Supply Co. Ltd (BESCOM) ₹409\nBill Amount ₹406\nPlatform fee (inclusive of GST) + ₹3\nTotal Amount ₹409\nPhonePe Transaction ID NB2610061738413128525472\nUTR: 984414123473\n06 Oct 2026");
  assert.equal(parsed.amount, 409);
  assert.equal(parsed.merchant, "Bangalore Electricity Supply Co. Ltd (BESCOM)");
  assert.equal(parsed.category, "Bills");
  assert.equal(parsed.provider, "PhonePe");
  assert.equal(parsed.date, new Date(2026, 9, 6, 12).toISOString());
});

test("reads super.money's amount, recipient, and date without selecting its reference ID", () => {
  const parsed = parsePaymentScreenshotText("super.money\nPayment Successful\n₹60\nAugust 26 at 5:11 PM\nTo: BANGALORE METRO\nUPI reference ID: 623883588844");
  assert.equal(parsed.amount, 60);
  assert.equal(parsed.merchant, "BANGALORE METRO");
  assert.equal(parsed.category, "Commute");
  assert.equal(parsed.provider, "super.money");
  assert.equal(new Date(parsed.date).getMonth(), 7);
  assert.equal(new Date(parsed.date).getDate(), 26);
});

test("reads Navi receipt details when the app label omits a transaction year from another field", () => {
  const parsed = parsePaymentScreenshotText("Paid securely on Navi UPI\nPayment successful\nto Nagarathnama\npaytm.s21vsek@pty\n₹20\n5 Nov 2026, 2:58 PM\nUPI txn ID: 667591284580");
  assert.equal(parsed.amount, 20);
  assert.equal(parsed.merchant, "Nagarathnama");
  assert.equal(parsed.provider, "Navi");
  assert.equal(parsed.date, new Date(2026, 10, 5, 12).toISOString());
});
