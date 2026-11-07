import { readFile } from "node:fs/promises";
import { adminAuth } from "./admin.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const fileIndex = args.indexOf("--file");
const filePath = fileIndex >= 0 ? args[fileIndex + 1] : null;
if (!filePath || filePath.startsWith("--")) {
  console.error("Usage: npm run plan:grant-first-333 -- --file promo-emails.csv [--apply]");
  process.exit(2);
}

function parseEmailList(contents) {
  const rows = contents.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const emails = rows.flatMap((line, index) => {
    const firstCell = line.split(",", 1)[0].trim().replace(/^\"|\"$/g, "");
    if (index === 0 && /^email$/i.test(firstCell)) return [];
    return [firstCell];
  });
  const unique = [];
  const seen = new Set();
  for (const email of emails) {
    const normalized = email.toLowerCase();
    if (!/^[-a-z0-9._%+]+@gmail\.com$/i.test(email)) {
      throw new Error(`Invalid Gmail address in the list: ${email || "(blank row)"}`);
    }
    if (seen.has(normalized)) throw new Error(`Duplicate email in the list: ${email}`);
    seen.add(normalized);
    unique.push(email);
  }
  if (unique.length < 333) throw new Error(`The list has ${unique.length} unique Gmail accounts; at least 333 are required.`);
  return unique.slice(0, 333);
}

try {
  const emails = parseEmailList(await readFile(filePath, "utf8"));
  const auth = await adminAuth();
  const expiry = new Date();
  expiry.setFullYear(expiry.getFullYear() + 1);
  const expiryMs = expiry.getTime();
  const accounts = [];

  for (const email of emails) {
    const user = await auth.getUserByEmail(email);
    const claims = user.customClaims || {};
    const plan = claims.plan;
    const activeUntil = Number(claims.planUntil);
    const activeGift = ["plus", "friend"].includes(plan) && (!activeUntil || activeUntil > Date.now());
    if (plan === "owner" || plan === "lifetime" || activeGift) {
      accounts.push({ email, user, skip: `already has ${plan}${activeUntil ? " access" : " permanent access"}` });
    } else {
      accounts.push({ email, user, skip: null });
    }
  }

  console.log(`First 333 eligible signup-list entries; proposed Plus expiry: ${expiry.toISOString()}`);
  for (const account of accounts) console.log(`${account.skip ? "SKIP" : apply ? "GRANT" : "DRY RUN"}  ${account.email}${account.skip ? ` — ${account.skip}` : ""}`);
  const grants = accounts.filter((account) => !account.skip);
  console.log(`${grants.length} account(s) would receive the one-year gift.`);

  if (apply) {
    for (const { user, skip } of accounts) {
      if (skip) continue;
      const claims = { ...(user.customClaims || {}), plan: "plus", planUntil: expiryMs };
      await auth.setCustomUserClaims(user.uid, claims);
    }
    console.log("Gift grants applied. Ask recipients to sign out and back in (or refresh their ID token). Keep the source list for your promotion records.");
  } else {
    console.log("No changes made. Review the ordered list, then rerun with --apply to grant access.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
