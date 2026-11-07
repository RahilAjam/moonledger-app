const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { getAuth } = require("firebase-admin/auth");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
initializeApp();
const db = getFirestore();
const messaging = getMessaging();

function requirePlanAdmin(request) {
  const claims = request.auth?.token;
  if (!claims || claims.plan !== "owner") throw new HttpsError("permission-denied", "Only a Moonledger owner can manage plan access.");
  if (claims.planUntil && Number(claims.planUntil) <= Date.now()) throw new HttpsError("permission-denied", "The owner access for this account has expired.");
}

function parsePlanRequest(data, allowRevoke = false) {
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  if (!/^[-a-z0-9._%+]+@gmail\.com$/i.test(email)) throw new HttpsError("invalid-argument", "Enter a valid Gmail address.");
  const plan = data.plan;
  const allowed = allowRevoke ? ["plus", "friend", "lifetime", "revoke"] : ["plus", "friend", "lifetime"];
  if (!allowed.includes(plan)) throw new HttpsError("invalid-argument", "Choose Plus, permanent friend access, or lifetime access.");
  let planUntil = null;
  if (data.planUntil !== undefined && data.planUntil !== null && data.planUntil !== "") {
    planUntil = Number(data.planUntil);
    if (!Number.isSafeInteger(planUntil) || planUntil <= Date.now() || planUntil > Date.now() + 10 * 366 * 24 * 60 * 60 * 1000) {
      throw new HttpsError("invalid-argument", "Expiry must be a future date within ten years.");
    }
  }
  if (plan === "lifetime" && planUntil) throw new HttpsError("invalid-argument", "Lifetime access cannot have an expiry date.");
  return { email, plan, planUntil };
}

exports.managePlanAccess = onCall({ region: "us-central1", maxInstances: 2 }, async (request) => {
  requirePlanAdmin(request);
  const { email, plan, planUntil } = parsePlanRequest(request.data || {}, true);
  const auth = getAuth();
  let target;
  try { target = await auth.getUserByEmail(email); }
  catch (error) {
    if (error.code === "auth/user-not-found") throw new HttpsError("not-found", "That Gmail account has not signed in to Moonledger yet.");
    throw error;
  }
  if (!target.emailVerified || !/@gmail\.com$/i.test(target.email || "")) throw new HttpsError("failed-precondition", "The account must be a verified Gmail account.");
  if (target.uid === request.auth.uid) throw new HttpsError("failed-precondition", "Use the local recovery process to change your own owner access.");
  if (target.customClaims?.plan === "owner") throw new HttpsError("failed-precondition", "Owner accounts cannot be changed from the online panel.");
  const customClaims = { ...(target.customClaims || {}) };
  delete customClaims.plan;
  delete customClaims.planUntil;
  if (plan !== "revoke") {
    customClaims.plan = plan;
    if (planUntil) customClaims.planUntil = planUntil;
  }
  await auth.setCustomUserClaims(target.uid, customClaims);
  console.info("Plan access updated", { actor: request.auth.uid, target: target.uid, plan, expires: planUntil || null });
  return { email, plan, planUntil };
});

function localClock(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date).reduce((result, part) => (result[part.type] = part.value, result), {});
  return { key: `${parts.year}-${parts.month}-${parts.day}`, month: `${parts.year}-${parts.month}`, day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute) };
}
async function send(tokenDoc, title, body) {
  const data = tokenDoc.data();
  try {
    await messaging.send({ token: data.token, notification: { title, body }, webpush: { fcmOptions: { link: "https://moonledger-2b6fb.web.app/" }, notification: { icon: "/moonledger-icon.svg", badge: "/moon.svg" } } });
    return true;
  } catch (error) {
    if (["messaging/registration-token-not-registered", "messaging/invalid-registration-token"].includes(error.code)) await tokenDoc.ref.delete();
    console.warn("Reminder delivery failed", error.code || error.message);
    return false;
  }
}
exports.sendScheduledNudges = onSchedule({ schedule: "every 15 minutes", timeZone: "UTC", region: "us-central1", retryCount: 0 }, async () => {
  const now = new Date();
  const tokens = await db.collectionGroup("notificationTokens").get();
  const devicesByUser = new Map();
  for (const tokenDoc of tokens.docs) {
    const data = tokenDoc.data();
    if (!data.userId || !data.token) continue;
    const list = devicesByUser.get(data.userId) || []; list.push(tokenDoc); devicesByUser.set(data.userId, list);
    const clock = localClock(now, data.timezone);
    if (data.eveningEnabled && clock.hour === 22 && clock.minute < 60 && data.lastEveningDate !== clock.key) {
      if (await send(tokenDoc, "Moonledger · evening check-in", "Any little spends to add from today?")) {
        await tokenDoc.ref.update({ lastEveningDate: clock.key, updatedAt: now.toISOString() });
      }
    }
  }
  const recurring = await db.collectionGroup("recurring").where("enabled", "==", true).get();
  for (const itemDoc of recurring.docs) {
    const item = itemDoc.data(); const owner = itemDoc.ref.parent.parent?.id;
    if (!owner || !item.dueDay) continue;
    const devices = devicesByUser.get(owner) || [];
    for (const tokenDoc of devices) {
      const clock = localClock(now, tokenDoc.data().timezone);
      const finalDay = new Date(Number(clock.month.slice(0, 4)), Number(clock.month.slice(5)) , 0).getDate();
      const dueDay = Math.min(Number(item.dueDay), finalDay);
      const todayUtc = Date.UTC(Number(clock.key.slice(0,4)), Number(clock.key.slice(5,7))-1, clock.day);
      let dueUtc = Date.UTC(Number(clock.key.slice(0,4)), Number(clock.key.slice(5,7))-1, dueDay);
      if (dueUtc < todayUtc) dueUtc = Date.UTC(Number(clock.key.slice(0,4)), Number(clock.key.slice(5,7)), dueDay);
      const daysLeft = Math.round((dueUtc - todayUtc) / 86400000);
      const reminderKey = `${clock.month}-${daysLeft}`;
      if ((daysLeft === 3 || daysLeft === 1) && item.lastReminderKey !== reminderKey) {
        if (await send(tokenDoc, `Upcoming ${item.kind || "bill"} · ${item.name}`, `${item.name} for ₹${Number(item.amount).toLocaleString("en-IN")} is due in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}.`)) {
          await itemDoc.ref.update({ lastReminderKey: reminderKey }); break;
        }
      }
    }
  }
});
