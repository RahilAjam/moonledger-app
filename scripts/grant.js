import { PLAN_NAMES } from "../src/plan.js";
import { adminAuth, parseExpiry } from "./admin.js";

const [email, plan, expiryText] = process.argv.slice(2);
if (!email || !plan || !PLAN_NAMES.has(plan)) {
  console.error("Usage: npm run plan:grant -- <gmail> <free|plus|lifetime|friend|owner> [expiry-ISO]");
  process.exit(2);
}
if (!/@gmail\.com$/i.test(email)) { console.error("Moonledger access is for verified Gmail accounts."); process.exit(2); }
if (expiryText && plan === "free") { console.error("Free access does not take an expiry; use plan:revoke to remove a grant."); process.exit(2); }

try {
  const until = parseExpiry(expiryText);
  const auth = await adminAuth();
  const user = await auth.getUserByEmail(email);
  if (!user.emailVerified) throw new Error("This Gmail account is not verified yet. Ask the user to sign in and verify it first.");
  const claims = { ...(user.customClaims || {}), plan };
  delete claims.planUntil;
  if (until !== null) claims.planUntil = until;
  await auth.setCustomUserClaims(user.uid, claims);
  console.log("Plan set to " + plan + (until ? " until " + new Date(until).toISOString() : "") + ". Ask the user to refresh their ID token by signing out and back in.");
} catch (error) { console.error(error.message); process.exitCode = 1; }
