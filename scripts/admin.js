import { readFile } from "node:fs/promises";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export async function adminAuth() {
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyPath) throw new Error("Set FIREBASE_SERVICE_ACCOUNT_KEY to the path of a private service-account JSON key.");
  let serviceAccount;
  try { serviceAccount = JSON.parse(await readFile(keyPath, "utf8")); }
  catch (error) { throw new Error("Could not read the service-account key at FIREBASE_SERVICE_ACCOUNT_KEY: " + error.message); }
  const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
  return getAuth(app);
}

export function parseExpiry(value) {
  if (value == null) return null;
  const expiry = Date.parse(value);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error("Expiry must be a future ISO date/time, such as 2027-01-31T23:59:59+05:30.");
  return expiry;
}
