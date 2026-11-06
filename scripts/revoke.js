import { adminAuth } from "./admin.js";

const [email] = process.argv.slice(2);
if (!email || !/@gmail\.com$/i.test(email)) {
  console.error("Usage: npm run plan:revoke -- <gmail>");
  process.exit(2);
}

try {
  const auth = await adminAuth();
  const user = await auth.getUserByEmail(email);
  const claims = { ...(user.customClaims || {}) };
  delete claims.plan;
  delete claims.planUntil;
  await auth.setCustomUserClaims(user.uid, claims);
  console.log("Plan access removed. The account now defaults to Free after its ID token is refreshed.");
} catch (error) { console.error(error.message); process.exitCode = 1; }
