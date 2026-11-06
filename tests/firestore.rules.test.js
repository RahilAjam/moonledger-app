import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

const projectId = "moonledger-rules-test";
let env;

function signedIn(uid, extraClaims = {}) {
  return env.authenticatedContext(uid, {
    email: uid + "@gmail.com",
    email_verified: true,
    firebase: { sign_in_provider: "google.com" },
    ...extraClaims
  }).firestore();
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
  });
});

after(async () => { await env?.cleanup(); });

test("users can only read and write their own expenses", async () => {
  const mine = signedIn("alice");
  const other = signedIn("bob");
  await assertSucceeds(setDoc(doc(mine, "users/alice/expenses/one"), {
    amount: 20, method: "Cash", category: "Food & drink", note: "Tea", date: "2026-11-07"
  }));
  await assertSucceeds(getDoc(doc(mine, "users/alice/expenses/one")));
  await assertFails(getDoc(doc(mine, "users/bob/expenses/one")));
  await assertFails(setDoc(doc(mine, "users/bob/expenses/two"), {
    amount: 20, method: "Cash", category: "Food & drink", note: "Tea", date: "2026-11-07"
  }));
  await assertFails(setDoc(doc(mine, "users/alice"), { plan: "owner" }));
});

test("only Plus claims can create a shared split for three or more people", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "challenges/circle/members/free-user"), { displayName: "Free", inviteCode: "unused", joinedAt: "2026-11-07" });
    await setDoc(doc(db, "challenges/another-circle/members/free-user"), { displayName: "Free", inviteCode: "unused", joinedAt: "2026-11-07" });
    await setDoc(doc(db, "challenges/circle/members/plus-user"), { displayName: "Plus", inviteCode: "unused", joinedAt: "2026-11-07" });
    await setDoc(doc(db, "challenges/circle/members/expired-user"), { displayName: "Expired", inviteCode: "unused", joinedAt: "2026-11-07" });
    await setDoc(doc(db, "users/free-user/circleAccess/freeSlot"), { circleId: "circle", createdAt: "2026-11-07" });
    await setDoc(doc(db, "users/expired-user/circleAccess/freeSlot"), { circleId: "circle", createdAt: "2026-11-07" });
    await setDoc(doc(db, "challenges/circle/splits/plus-only"), {
      title: "Dinner", total: 900, participantCount: 3, createdBy: "plus-user", createdByName: "Plus", createdAt: "2026-11-07"
    });
  });
  const free = signedIn("free-user", { plan: "free" });
  const plus = signedIn("plus-user", { plan: "friend" });
  const split = { title: "Dinner", total: 900, participantCount: 3, createdBy: "free-user", createdByName: "Free", createdAt: "2026-11-07" };
  await assertFails(getDoc(doc(free, "challenges/another-circle/members/free-user")));
  await assertFails(getDoc(doc(free, "challenges/circle/splits/plus-only")));
  await assertSucceeds(getDoc(doc(plus, "challenges/circle/splits/plus-only")));
  await assertFails(setDoc(doc(free, "challenges/circle/splits/blocked"), split));
  await assertSucceeds(setDoc(doc(plus, "challenges/circle/splits/allowed"), { ...split, createdBy: "plus-user", createdByName: "Plus" }));
});

test("an expired Plus claim cannot write a Plus-only shared split", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "challenges/circle/members/expired-user"), { displayName: "Expired", inviteCode: "unused", joinedAt: "2026-11-07" });
    await setDoc(doc(db, "users/expired-user/circleAccess/freeSlot"), { circleId: "circle", createdAt: "2026-11-07" });
  });
  const expired = signedIn("expired-user", { plan: "owner", planUntil: Date.now() - 1000 });
  await assertFails(setDoc(doc(expired, "challenges/circle/splits/blocked"), {
    title: "Dinner", total: 900, participantCount: 3, createdBy: "expired-user", createdByName: "Expired", createdAt: "2026-11-07"
  }));
});
