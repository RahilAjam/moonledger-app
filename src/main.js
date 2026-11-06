import { initializeApp } from "firebase/app";
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import {
  browserLocalPersistence, getAuth, getRedirectResult, GoogleAuthProvider, onAuthStateChanged,
  setPersistence, signInWithPopup, signInWithRedirect, signOut
} from "firebase/auth";
import {
  addDoc, collection, deleteDoc, doc, getDoc, getFirestore, initializeFirestore,
  onSnapshot, orderBy, persistentLocalCache, persistentMultipleTabManager, query,
  setDoc, updateDoc, writeBatch, serverTimestamp
} from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";
import { parseExpenseText, makeExpenseCsv } from "./feature-tools.js";

const { vapidKey, ...appOptions } = firebaseConfig;
const app = initializeApp(appOptions);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
const $ = (id) => document.getElementById(id);
const themeKey = "moonledger-theme-v1";
const reminderKey = "moonledger-reminder-v1";
const remindedKey = "moonledger-last-reminder-v1";
const guestDataKey = "moonledger-guest-data-v1";
const gate = $("authGate");
const shell = $("appShell");
const mobileNav = document.querySelector(".mobile-nav");
const monthSelect = $("monthSelect");
let db;
let user = null;
let guestMode = false;
let editingExpenseId = null;
let expenses = [];
let budgets = {};
let recurringItems = [];
let debtItems = [];
let noSpendDates = [];
let stopTools = [];
let reviewIndex = 0;
let sharedText = new URL(location.href).searchParams.get("text") || new URL(location.href).searchParams.get("title") || "";
if (new URL(location.href).searchParams.has("text") || new URL(location.href).searchParams.has("title")) history.replaceState({}, "", location.pathname + location.hash);
let method = "UPI";
let showAll = false;
let currentView = "Overview";
let expenseMethodFilter = "all";
let expenseCategoryFilter = "all";
let expenseSearchText = "";
let lastCreatedExpense = null;
let accountGreeting = "Your money, in view.";
let stopExpenses;
let stopBudget;
let stopChallenges;
let stopChallengeMembers = [];
let stopSharedSplitListeners = [];
let sharedSplits = [];
let joinedChallenges = [];
let challengeMemberData = [];
let reminderEnabled = localStorage.getItem(reminderKey) !== "off";

function getDatabase() {
  if (db) return db;
  if (localStorage.getItem("moonledger-offline-enabled") === "true") {
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
      });
      return db;
    } catch (error) {
      console.warn("Persistent offline storage is unavailable; using memory cache.", error);
    }
  }
  db = getFirestore(app);
  return db;
}

function userCollection(name) {
  return collection(getDatabase(), "users", user.uid, name);
}

function readGuestData() {
  try {
    const data = JSON.parse(localStorage.getItem(guestDataKey) || "{}");
    return {
      noSpendChallengeStart: typeof data.noSpendChallengeStart === "string" ? data.noSpendChallengeStart : "",
      expenses: Array.isArray(data.expenses) ? data.expenses : [],
      budgets: data.budgets && typeof data.budgets === "object" ? data.budgets : {},
      recurringItems: Array.isArray(data.recurringItems) ? data.recurringItems : [],
      debtItems: Array.isArray(data.debtItems) ? data.debtItems : [],
      noSpendDates: Array.isArray(data.noSpendDates) ? data.noSpendDates : [],
      syncedRecurringIds: Array.isArray(data.syncedRecurringIds) ? data.syncedRecurringIds : [],
      syncedDebtIds: Array.isArray(data.syncedDebtIds) ? data.syncedDebtIds : [],
      syncedNoSpendDates: Array.isArray(data.syncedNoSpendDates) ? data.syncedNoSpendDates : [],
      syncedExpenseIds: Array.isArray(data.syncedExpenseIds) ? data.syncedExpenseIds : [],
      uploadedExpenseIds: Array.isArray(data.uploadedExpenseIds) ? data.uploadedExpenseIds : [],
      deletedExpenseIds: Array.isArray(data.deletedExpenseIds) ? data.deletedExpenseIds : [],
      syncedBudgetMonths: Array.isArray(data.syncedBudgetMonths) ? data.syncedBudgetMonths : [],
      overwriteBudgetMonths: Array.isArray(data.overwriteBudgetMonths) ? data.overwriteBudgetMonths : []
    };
  } catch { return { expenses: [], budgets: {}, recurringItems: [], debtItems: [], noSpendDates: [], syncedRecurringIds: [], syncedDebtIds: [], syncedNoSpendDates: [], syncedExpenseIds: [], uploadedExpenseIds: [], deletedExpenseIds: [], syncedBudgetMonths: [], overwriteBudgetMonths: [] }; }
}

function writeGuestData(data) { localStorage.setItem(guestDataKey, JSON.stringify(data)); }
function paydayStorageKey() { return "moonledger-payday-" + (user?.uid || "guest"); }
function onboardingStorageKey() { return "moonledger-onboarded-" + (user?.uid || "guest"); }
function quickPresetStorageKey() { return "moonledger-quick-presets-" + (user?.uid || "guest"); }
function readQuickPresets() {
  try { const value = JSON.parse(localStorage.getItem(quickPresetStorageKey()) || "[]"); return Array.isArray(value) ? value.slice(0, 5) : []; }
  catch { return []; }
}
function maybeShowOnboarding() {
  if ((!user && !guestMode) || localStorage.getItem(onboardingStorageKey()) || sharedText || $("guestImportModal").classList.contains("open")) return;
  $("onboardingBudget").value = budgets[monthSelect.value] || "";
  const payday = localStorage.getItem(paydayStorageKey()); $("onboardingPayday").value = payday || "";
  $("onboardingModal").classList.add("open");
  $("onboardingBudgetStep").hidden = false; $("onboardingPicksStep").hidden = true;
  $("onboardingStepLabel").textContent = "A softer start · 1 of 2";
  $("onboardingNext").hidden = false; $("onboardingFinish").hidden = true;
  setTimeout(() => $("onboardingBudget").focus(), 100);
}
function closeOnboarding() { localStorage.setItem(onboardingStorageKey(), "done"); $("onboardingModal").classList.remove("open"); }
$("onboardingNext").onclick = () => {
  $("onboardingBudgetStep").hidden = true; $("onboardingPicksStep").hidden = false;
  $("onboardingStepLabel").textContent = "A softer start · 2 of 2";
  $("onboardingNext").hidden = true; $("onboardingFinish").hidden = false;
};
$("onboardingSkip").onclick = closeOnboarding;
document.querySelectorAll("[data-pick]").forEach((button) => button.onclick = () => {
  const selected = button.classList.toggle("selected"); button.setAttribute("aria-pressed", String(selected));
});
$("onboardingFinish").onclick = async () => {
  $("onboardingError").textContent = "";
  try {
  const amount = Number($("onboardingBudget").value);
  const payday = $("onboardingPayday").value;
  if (payday) localStorage.setItem(paydayStorageKey(), payday);
  const presets = Array.from(document.querySelectorAll("[data-pick].selected"), (button) => ({ note: button.dataset.pick, amount: Number(button.dataset.amount), category: button.dataset.category, method: button.dataset.method }));
  localStorage.setItem(quickPresetStorageKey(), JSON.stringify(presets));
  if (amount > 0) {
    if (guestMode) { const data = readGuestData(); data.budgets[monthSelect.value] = amount; writeGuestData(data); budgets = data.budgets; }
    else if (user) { budgets[monthSelect.value] = amount; await setDoc(doc(userCollection("budgets"), monthSelect.value), { amount, updatedAt: new Date().toISOString() }, { merge: true }); }
  }
  syncPaydayControl(); closeOnboarding(); render(); updateBudget();
  } catch (error) { $("onboardingError").textContent = "Couldn’t save your setup yet: " + error.message; }
};
function syncPaydayControl() {
  const stored = localStorage.getItem(paydayStorageKey());
  $("paydayDate").value = stored ? dateInputValue(new Date(stored)) : "";
}
$("paydayDate").addEventListener("change", () => {
  if ($("paydayDate").value) localStorage.setItem(paydayStorageKey(), $("paydayDate").value);
  else localStorage.removeItem(paydayStorageKey());
  updateBudget();
});
function greetingText(name = "") {
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const first = String(name || "").trim().split(/\s+/)[0];
  return first ? hello + ", " + first : hello;
}
function showSaveToast() {
  let toast = $("saveToast");
  if (!toast) {
    toast = document.createElement("div"); toast.id = "saveToast"; toast.className = "save-toast"; toast.setAttribute("role", "status");
    toast.innerHTML = '<span>✦ &nbsp;Nice, saved.</span><button type="button" aria-label="Undo saving this expense">Undo</button>';
    document.body.append(toast);
    toast.querySelector("button").onclick = async () => {
      if (!lastCreatedExpense) return;
      const entry = lastCreatedExpense; lastCreatedExpense = null;
      try {
        if (guestMode) { expenses = expenses.filter((item) => item.id !== entry.id); saveGuestExpenses(); }
        else if (user) await deleteDoc(doc(userCollection("expenses"), entry.id));
        toast.hidden = true; render();
      } catch (error) { toast.querySelector("span").textContent = "Could not undo · " + error.message; }
    };
  }
  toast.hidden = false;
  clearTimeout(showSaveToast.timer); showSaveToast.timer = setTimeout(() => { toast.hidden = true; lastCreatedExpense = null; }, 5000);
  if (navigator.vibrate) navigator.vibrate(12);
}
function saveGuestExpenses() {
  const data = readGuestData(); data.expenses = expenses; writeGuestData(data);
}
function setGuestMode() {
  guestMode = true; user = null; expenses = readGuestData().expenses; budgets = readGuestData().budgets;
  const guestData = readGuestData(); recurringItems = guestData.recurringItems; debtItems = guestData.debtItems; noSpendDates = guestData.noSpendDates;
  joinedChallenges = []; challengeMemberData = []; stopChallengeListeners();
  gate.hidden = true; shell.hidden = false; mobileNav.hidden = false; $("signOutBtn").hidden = false;
  $("signOutBtn").textContent = "Exit guest";
  $("accountEmail").textContent = "Guest · this device";
  $("accountEmail").title = "Guest data is stored only in this browser";
  accountGreeting = greetingText(); $("greeting").textContent = accountGreeting;
  syncPaydayControl();
  $("accountName").textContent = "Guest space"; $("accountEmailDetail").textContent = "Stored on this device only";
  $("sideName").textContent = "Me"; $("avatar").textContent = "G"; $("accountAvatar").textContent = "G";
  $("guestBanner").hidden = false; $("leaderboardCard").hidden = true;
  $("cloudStatus").textContent = "Guest mode · entries stay in this browser until you choose to sync.";
  render(); renderTools(); watchBudget(monthSelect.value); setView(currentView); openSharedTextIfPresent(); setTimeout(maybeShowOnboarding, 350);
}

function pendingGuestData() {
  const data = readGuestData();
  return {
    data,
    expenses: data.expenses.filter((entry) => !data.syncedExpenseIds.includes(entry.id)),
    deletions: data.deletedExpenseIds,
    budgets: Object.entries(data.budgets).filter(([month]) => !data.syncedBudgetMonths.includes(month)),
    recurringItems: data.recurringItems.filter((item) => !data.syncedRecurringIds.includes(item.id)),
    debtItems: data.debtItems.filter((item) => !data.syncedDebtIds.includes(item.id)),
    noSpendDates: data.noSpendDates.filter((day) => !data.syncedNoSpendDates.includes(day))
  };
}

function updateGuestImportPanel() {
  const pending = pendingGuestData();
  const hasPending = pending.expenses.length > 0 || pending.budgets.length > 0 || pending.deletions.length > 0 || pending.recurringItems.length > 0 || pending.debtItems.length > 0 || pending.noSpendDates.length > 0;
  $("guestImportPanel").hidden = !user || !hasPending;
  $("guestImportDetail").textContent = pending.expenses.length + " expense" + (pending.expenses.length === 1 ? "" : "s") + ", " + pending.deletions.length + " deletion" + (pending.deletions.length === 1 ? "" : "s") + " and " + pending.budgets.length + " budget" + (pending.budgets.length === 1 ? "" : "s") + ", " + pending.recurringItems.length + " bills/subscriptions, " + pending.debtItems.length + " IOUs and " + pending.noSpendDates.length + " no-spend check-ins ready to sync from this device.";
  return pending;
}

function openGuestImportModal() {
  if (!user) return;
  const pending = updateGuestImportPanel();
  if (!pending.expenses.length && !pending.budgets.length && !pending.deletions.length && !pending.recurringItems.length && !pending.debtItems.length && !pending.noSpendDates.length) return;
  $("guestImportSummary").textContent = "Sync your guest expenses, budgets, bills, subscriptions, IOUs, and no-spend check-ins into " + (user.email || "your Google account") + "?";
  $("guestImportModal").classList.add("open");
}

async function syncGuestData() {
  if (!user) return;
  const pending = pendingGuestData();
  const data = pending.data;
  try {
    if (data.deletedExpenseIds.length) {
      const deleted = data.deletedExpenseIds.slice();
      for (let start = 0; start < deleted.length; start += 400) {
        const batch = writeBatch(getDatabase());
        deleted.slice(start, start + 400).forEach((id) => batch.delete(doc(userCollection("expenses"), "guest_" + String(id).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100))));
        await batch.commit();
      }
      data.deletedExpenseIds = [];
      data.uploadedExpenseIds = data.uploadedExpenseIds.filter((id) => !deleted.includes(id));
      data.syncedExpenseIds = data.syncedExpenseIds.filter((id) => !deleted.includes(id));
    }
    for (let start = 0; start < pending.expenses.length; start += 400) {
      const batch = writeBatch(getDatabase());
      pending.expenses.slice(start, start + 400).forEach((entry) => {
        const safeId = String(entry.id || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
        const { amount, method: paymentMethod, category, note, date } = entry;
        batch.set(doc(userCollection("expenses"), "guest_" + safeId), { amount: Number(amount), method: paymentMethod, category, note: String(note || "").slice(0, 80), date: new Date(date).toISOString() });
      });
      await batch.commit();
    }
    for (const [collectionName, rows] of [["recurring", pending.recurringItems], ["debts", pending.debtItems]]) {
      for (let start = 0; start < rows.length; start += 400) {
        const batch = writeBatch(getDatabase());
        rows.slice(start, start + 400).forEach((item) => { const safeId = String(item.id || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100); const { id, ...fields } = item; batch.set(doc(userCollection(collectionName), "guest_" + safeId), fields); });
        await batch.commit();
      }
    }
    if (pending.noSpendDates.length) {
      const batch = writeBatch(getDatabase());
      pending.noSpendDates.forEach((day) => batch.set(doc(userCollection("noSpendDays"), day), { date: day }));
      await batch.commit();
    }
    const importedIds = pending.expenses.map((entry) => entry.id).filter(Boolean);
    for (const [month, amount] of pending.budgets) {
      const budgetRef = doc(userCollection("budgets"), month);
      const existing = await getDoc(budgetRef);
      const overwrite = data.overwriteBudgetMonths.includes(month);
      if (overwrite || !existing.exists()) {
        await setDoc(budgetRef, { amount: Number(amount), updatedAt: new Date().toISOString() });
      }
    }
    data.syncedExpenseIds = Array.from(new Set([...data.syncedExpenseIds, ...importedIds]));
    data.uploadedExpenseIds = Array.from(new Set([...data.uploadedExpenseIds, ...importedIds]));
    data.syncedBudgetMonths = Array.from(new Set([...data.syncedBudgetMonths, ...pending.budgets.map(([month]) => month)]));
    data.syncedRecurringIds = Array.from(new Set([...data.syncedRecurringIds, ...pending.recurringItems.map((item) => item.id)]));
    data.syncedDebtIds = Array.from(new Set([...data.syncedDebtIds, ...pending.debtItems.map((item) => item.id)]));
    data.syncedNoSpendDates = Array.from(new Set([...data.syncedNoSpendDates, ...pending.noSpendDates]));
    data.overwriteBudgetMonths = data.overwriteBudgetMonths.filter((month) => !pending.budgets.some(([pendingMonth]) => pendingMonth === month));
    writeGuestData(data);
    $("guestImportModal").classList.remove("open");
    updateGuestImportPanel();
    $("cloudStatus").textContent = "Guest entries copied to your private account. A local copy remains on this device.";
  } catch (error) {
    $("guestImportSummary").textContent = "Could not sync those entries yet: " + error.message;
  }
}

function currentMonthTotals() {
  const [year, month] = (monthSelect.value || "").split("-").map(Number);
  const spent = expenses.filter((entry) => {
    const date = new Date(entry.date);
    return date.getFullYear() === year && date.getMonth() + 1 === month;
  }).reduce((sum, entry) => sum + Number(entry.amount), 0);
  return { month: monthSelect.value, budget: Number(budgets[monthSelect.value] || 0), spent };
}

function challengeRef(id) { return doc(getDatabase(), "challenges", id); }
function membershipRef(id, uid = user.uid) { return doc(getDatabase(), "challenges", id, "members", uid); }
function memberRef(id, uid = user.uid, month = monthSelect.value) { return doc(getDatabase(), "challenges", id, "months", month, "members", uid); }
function stopChallengeListeners() {
  stopChallenges?.(); stopChallenges = null;
  stopChallengeMembers.forEach((stop) => stop()); stopChallengeMembers = [];
  stopSharedSplitListeners.forEach((stop) => stop()); stopSharedSplitListeners = []; sharedSplits = [];
}

function syncChallengeSummary() {
  if (!user || !joinedChallenges.length) return;
  const summary = currentMonthTotals();
  joinedChallenges.forEach((challenge) => {
    setDoc(memberRef(challenge.id, user.uid, summary.month), {
      displayName: (user.displayName || user.email?.split("@")[0] || "Moonledger user").slice(0, 40),
      month: summary.month, budget: summary.budget, spent: summary.spent,
      updatedAt: new Date().toISOString()
    }, { merge: true }).catch((error) => console.warn("Savings challenge summary did not sync.", error));
  });
}

function watchChallenges() {
  stopChallengeListeners();
  if (!user) return;
  stopChallenges = onSnapshot(userCollection("challenges"), async (snapshot) => {
    joinedChallenges = await Promise.all(snapshot.docs.map(async (entry) => {
      const metadata = entry.data();
      const group = await getDoc(challengeRef(entry.id));
      return group.exists() ? { id: entry.id, name: metadata.name || group.data().name || "Savings circle", inviteCode: metadata.inviteCode || "" } : null;
    }));
    joinedChallenges = joinedChallenges.filter(Boolean);
    watchChallengeMembers();
    watchSharedSplits();
    syncChallengeSummary();
    renderLeaderboard();
  }, (error) => { $("challengeStatus").textContent = "Savings circles are unavailable: " + error.message; });
}

function watchChallengeMembers() {
  stopChallengeMembers.forEach((stop) => stop()); stopChallengeMembers = [];
  challengeMemberData = [];
  if (!user || !joinedChallenges.length || !monthSelect.value) { renderLeaderboard(); return; }
  joinedChallenges.forEach((challenge) => {
    const stop = onSnapshot(collection(getDatabase(), "challenges", challenge.id, "months", monthSelect.value, "members"), (members) => {
      const byId = new Map(challengeMemberData.filter((item) => item.challengeId !== challenge.id).map((item) => [item.challengeId + ":" + item.id, item]));
      members.docs.forEach((entry) => byId.set(challenge.id + ":" + entry.id, { id: entry.id, challengeId: challenge.id, challengeName: challenge.name, ...entry.data() }));
      challengeMemberData = Array.from(byId.values()); renderLeaderboard();
    }, (error) => { console.warn("Savings circle could not load.", error); });
    stopChallengeMembers.push(stop);
  });
}

function watchSharedSplits() {
  stopSharedSplitListeners.forEach((stop) => stop()); stopSharedSplitListeners = []; sharedSplits = [];
  if (!user || !joinedChallenges.length) { renderTools(); return; }
  joinedChallenges.forEach((challenge) => {
    const stop = onSnapshot(collection(getDatabase(), "challenges", challenge.id, "splits"), (snapshot) => {
      sharedSplits = [...sharedSplits.filter((row) => row.challengeId !== challenge.id), ...snapshot.docs.map((entry) => ({ id: entry.id, challengeId: challenge.id, circleName: challenge.name, ...entry.data() }))];
      renderTools();
    }, (error) => console.warn("Shared circle costs could not load.", error));
    stopSharedSplitListeners.push(stop);
  });
}

function renderLeaderboard() {
  const container = $("leaderboard");
  if (!container) return;
  $("leaderPeriod").textContent = monthSelect.options[monthSelect.selectedIndex]?.text || "";
  const inviteCode = joinedChallenges.find((entry) => entry.inviteCode)?.inviteCode;
  const inviteLine = inviteCode ? '<div class="leader-invite">Your invite code <strong>' + escapeHtml(inviteCode) + '</strong> · share it with a friend</div>' : '';
  const entries = challengeMemberData.filter((item) => item.month === monthSelect.value && Number(item.budget) > 0)
    .map((item) => ({ ...item, saved: Number(item.budget) - Number(item.spent), rate: (Number(item.budget) - Number(item.spent)) / Number(item.budget) }))
    .sort((a, b) => b.saved - a.saved);
  if (!joinedChallenges.length) {
    container.innerHTML = '<div class="leader-empty"><div><strong>Make saving a little more fun</strong><p>Start a private circle with friends. Compare how much of your budget each person keeps.</p></div></div>';
  } else if (!entries.length) {
    container.innerHTML = '<div class="leader-empty"><div><strong>Your circle is ready</strong><p>Set a budget for ' + escapeHtml(monthSelect.options[monthSelect.selectedIndex]?.text || "this month") + ' to appear on the leaderboard.</p></div></div>' + inviteLine;
  } else {
    const myRank = entries.findIndex((entry) => entry.id === user.uid) + 1;
    container.innerHTML = '<div class="leader-heading"><div><strong>' + escapeHtml(joinedChallenges.map((item) => item.name).join(" · ")) + '</strong><p>Ranked by the amount left in each budget.</p></div><span class="leader-rank">' + (myRank ? "Your rank · #" + myRank : "Savings circle") + '</span></div>' +
      entries.slice(0, 8).map((entry, index) => '<div class="leader-row"><span class="leader-place">' + (index === 0 ? "✦" : String(index + 1).padStart(2, "0")) + '</span><div class="leader-person"><strong>' + escapeHtml(entry.displayName || "Moonledger user") + (entry.id === user.uid ? ' <small>You</small>' : '') + '</strong><div class="leader-meter"><i style="width:' + Math.max(0, Math.min(100, entry.rate * 100)) + '%"></i></div></div><div class="leader-saved"><strong>' + money(entry.saved) + '</strong><small>' + Math.round(entry.rate * 100) + '% left</small></div></div>').join("") +
      inviteLine +
      '<div class="leader-privacy">Only your name, monthly budget, and total spending are shared with circle members. Individual expenses stay private.</div>';
  }
}

function closeChallengeModals() {
  $("challengeCreateModal").classList.remove("open");
  $("challengeJoinModal").classList.remove("open");
}

$("challengeCreateForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!user) return;
  const name = $("challengeName").value.trim().slice(0, 40) || "Savings circle";
  const id = doc(collection(getDatabase(), "challenges")).id;
  const inviteCode = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  const rateRef = doc(userCollection("inviteRateLimits"), "circles");
  let rateSnapshot;
  try { rateSnapshot = await getDoc(rateRef); } catch (error) { $("challengeCreateError").textContent = "Could not check the invite limit: " + error.message; return; }
  const previous = rateSnapshot.exists() ? rateSnapshot.data() : null;
  const windowActive = previous?.windowStartedAt?.toMillis && Date.now() - previous.windowStartedAt.toMillis() < 24 * 60 * 60 * 1000;
  const nextCount = windowActive ? Number(previous.count || 0) + 1 : 1;
  if (nextCount > 10) { $("challengeCreateError").textContent = "You’ve reached the limit of 10 circle invites in 24 hours. Try again later."; return; }
  const group = challengeRef(id);
  const summary = currentMonthTotals();
  const batch = writeBatch(getDatabase());
  batch.set(rateRef, { count: nextCount, windowStartedAt: windowActive ? previous.windowStartedAt : serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(group, { name, ownerId: user.uid, createdAt: new Date().toISOString() });
  batch.set(doc(getDatabase(), "challengeInvites", inviteCode), { challengeId: id, name, createdBy: user.uid });
  batch.set(membershipRef(id), { displayName: (user.displayName || user.email?.split("@")[0] || "You").slice(0, 40), inviteCode, joinedAt: new Date().toISOString() });
  batch.set(memberRef(id, user.uid, summary.month), { displayName: (user.displayName || user.email?.split("@")[0] || "You").slice(0, 40), ...summary, updatedAt: new Date().toISOString() });
  batch.set(doc(userCollection("challenges"), id), { name, inviteCode, joinedAt: new Date().toISOString() });
  try {
    await batch.commit(); closeChallengeModals(); event.target.reset();
    $("challengeStatus").textContent = "Circle created. Share invite code " + inviteCode + " with friends.";
  } catch (error) { $("challengeCreateError").textContent = "Could not create the circle: " + error.message; }
};

$("challengeJoinForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!user) return;
  const code = $("challengeCode").value.trim().toUpperCase();
  try {
    const invitation = await getDoc(doc(getDatabase(), "challengeInvites", code));
    if (!invitation.exists()) { $("challengeJoinError").textContent = "That invite code wasn’t found. Check it and try again."; return; }
    const details = invitation.data();
    const batch = writeBatch(getDatabase());
    const summary = currentMonthTotals();
    batch.set(membershipRef(details.challengeId), { displayName: (user.displayName || user.email?.split("@")[0] || "You").slice(0, 40), inviteCode: code, joinedAt: new Date().toISOString() });
    batch.set(memberRef(details.challengeId, user.uid, summary.month), { displayName: (user.displayName || user.email?.split("@")[0] || "You").slice(0, 40), ...summary, updatedAt: new Date().toISOString() });
    batch.set(doc(userCollection("challenges"), details.challengeId), { name: details.name || "Savings circle", inviteCode: code, joinedAt: new Date().toISOString() });
    await batch.commit(); closeChallengeModals(); event.target.reset();
    $("challengeStatus").textContent = "You joined " + (details.name || "the savings circle") + ".";
  } catch (error) { $("challengeJoinError").textContent = "Could not join the circle: " + error.message; }
};
$("cancelChallengeCreate").onclick = closeChallengeModals;
$("cancelChallengeJoin").onclick = closeChallengeModals;
$("createChallenge").onclick = () => $("challengeCreateModal").classList.add("open");
$("joinChallenge").onclick = () => $("challengeJoinModal").classList.add("open");

function showSignedOut() {
  gate.hidden = false;
  shell.hidden = true;
  mobileNav.hidden = true;
  $("signOutBtn").hidden = true;
  $("guestBanner").hidden = true;
  guestMode = false;
}

function showSignedIn(signedInUser) {
  user = signedInUser;
  guestMode = false;
  gate.hidden = true;
  shell.hidden = false;
  mobileNav.hidden = false;
  $("signOutBtn").hidden = false;
  $("signOutBtn").textContent = "Sign out";
  $("guestBanner").hidden = true;
  const name = (user.displayName || user.email?.split("@")[0] || "You").trim();
  $("accountEmail").textContent = user.email || "Google account";
  $("accountEmail").title = user.email || "Google account";
  accountGreeting = greetingText(name);
  syncPaydayControl();
  $("greeting").textContent = accountGreeting;
  $("accountName").textContent = name + "’s Moonledger account";
  $("accountEmailDetail").textContent = user.email || "Google account";
  $("accountAvatar").textContent = name.charAt(0).toUpperCase();
  $("sideName").textContent = "Me";
  $("avatar").textContent = name.charAt(0).toUpperCase();
  startSync();
  watchChallenges();
  setView(currentView);
  updateGuestImportPanel();
  const guestPending = pendingGuestData();
  if (guestPending.expenses.length || guestPending.budgets.length || guestPending.deletions.length || guestPending.recurringItems.length || guestPending.debtItems.length || guestPending.noSpendDates.length) setTimeout(openGuestImportModal, 400);
  else setTimeout(maybeShowOnboarding, 350);
}

async function signIn() {
  const errorBox = $("authError");
  errorBox.textContent = "";
  localStorage.setItem("moonledger-offline-enabled", $("offlineConsent").checked ? "true" : "false");
  try {
    await setPersistence(auth, browserLocalPersistence);
    getDatabase();
    if (matchMedia("(max-width: 700px)").matches) await signInWithRedirect(auth, provider);
    else await signInWithPopup(auth, provider);
  } catch (error) {
    if (error.code === "auth/popup-blocked" || error.code === "auth/popup-closed-by-user") {
      try { await signInWithRedirect(auth, provider); return; } catch (redirectError) { error = redirectError; }
    }
    errorBox.textContent = error.message || "Google sign-in could not start. Please try again.";
  }
}

$("googleSignIn").addEventListener("click", signIn);
$("guestStart").addEventListener("click", setGuestMode);
$("guestSignIn").addEventListener("click", signIn);
$("importGuestData").addEventListener("click", openGuestImportModal);
$("skipGuestSync").addEventListener("click", () => $("guestImportModal").classList.remove("open"));
$("confirmGuestSync").addEventListener("click", syncGuestData);
$("signOutBtn").addEventListener("click", async () => {
  if (guestMode) { showSignedOut(); return; }
  stopExpenses?.();
  stopBudget?.();
  stopTools.forEach((stop) => stop()); stopTools = [];
  stopChallengeListeners();
  const tokenId = user && localStorage.getItem("moonledger-push-token-" + user.uid);
  if (tokenId) { await deleteDoc(doc(userCollection("notificationTokens"), tokenId)).catch(() => {}); localStorage.removeItem("moonledger-push-token-" + user.uid); }
  await signOut(auth);
  showSignedOut();
});

function startSync() {
  if (!user) return;
  stopExpenses?.();
  stopBudget?.();
  stopTools.forEach((stop) => stop()); stopTools = [];
  const expensesQuery = query(userCollection("expenses"), orderBy("date", "desc"));
  stopExpenses = onSnapshot(expensesQuery, (snapshot) => {
    expenses = snapshot.docs.map((entry) => Object.assign({ id: entry.id }, entry.data()));
    render();
    syncChallengeSummary();
    $("cloudStatus").textContent = !navigator.onLine || snapshot.metadata.fromCache
      ? "Offline mode · changes will sync when you reconnect."
      : "Synced to your private account.";
    $("accountCloudStatus").textContent = $("cloudStatus").textContent;
  }, (error) => { $("cloudStatus").textContent = "Couldn’t load expenses: " + error.message; $("accountCloudStatus").textContent = $("cloudStatus").textContent; });
  watchBudget(monthSelect.value);
  for (const [name, setter] of [["recurring", (rows) => recurringItems = rows], ["debts", (rows) => debtItems = rows], ["noSpendDays", (rows) => noSpendDates = rows.map((row) => row.date)]]) {
    stopTools.push(onSnapshot(userCollection(name), (snapshot) => {
      setter(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })));
      renderTools(); renderInsights();
    }, (error) => { console.warn("Private account tool could not sync.", error); }));
  }
  openSharedTextIfPresent();
}

function watchBudget(month) {
  stopBudget?.();
  if (guestMode && month) {
    budgets = readGuestData().budgets;
    updateBudget();
    return;
  }
  budgets = {};
  if (!user || !month) return;
  stopBudget = onSnapshot(doc(userCollection("budgets"), month), (snapshot) => {
    budgets[month] = snapshot.exists() ? Number(snapshot.data().amount || 0) : 0;
    updateBudget();
    syncChallengeSummary(); renderLeaderboard();
  }, (error) => { $("cloudStatus").textContent = "Couldn’t load budget: " + error.message; });
}

const icons = { "Food & drink": "☕", "Food delivery": "🥡", Groceries: "🛒", Commute: "↗", Rent: "⌂", Subscriptions: "▣", "Going out": "✦", Travel: "↗", Shopping: "◇", Bills: "⌂", Health: "✚", Home: "⌂", Entertainment: "♫", Other: "·" };
const money = (amount) => "₹" + Number(amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function currentDayKey(date = new Date()) { return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0"); }
function renderTools() {
  const due = recurringItems.filter((item) => item.enabled !== false).map((item) => {
    const now = new Date(); const thisDue = new Date(now.getFullYear(), now.getMonth(), Math.min(Number(item.dueDay) || 1, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()), 12);
    if (thisDue < new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)) thisDue.setMonth(thisDue.getMonth() + 1);
    return { ...item, nextDue: thisDue, days: Math.ceil((thisDue - new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)) / 86400000) };
  }).sort((a, b) => a.days - b.days);
  checkLocalBillReminders(due);
  const recurringList = $("recurringList");
  if (recurringList) recurringList.innerHTML = due.length ? due.map((item) => '<div class="tool-row"><div><strong>' + escapeHtml(item.name) + '</strong><small>' + escapeHtml(item.kind === "subscription" ? "Subscription" : "Bill") + ' · due ' + item.nextDue.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + ' · ' + (item.days === 0 ? "today" : item.days + " days") + '</small></div><b>' + money(item.amount) + '</b><button class="tool-delete" data-tool-delete="recurring" data-id="' + escapeHtml(item.id) + '" aria-label="Delete ' + escapeHtml(item.name) + '">×</button></div>').join("") : '<div class="empty">No bills or subscriptions yet.</div>';
  const circleSelect = $("sharedSplitCircle");
  if (circleSelect) {
    const selected = circleSelect.value;
    circleSelect.innerHTML = '<option value="">' + (joinedChallenges.length ? "Choose a circle" : "Create or join a circle first") + '</option>' + joinedChallenges.map((circle) => '<option value="' + escapeHtml(circle.id) + '">' + escapeHtml(circle.name) + '</option>').join("");
    if (joinedChallenges.some((circle) => circle.id === selected)) circleSelect.value = selected;
  }
  const splitList = $("sharedSplitList");
  if (splitList) splitList.innerHTML = sharedSplits.length ? sharedSplits.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map((item) => {
    const count = Math.max(2, Number(item.participantCount) || 2); const share = Number(item.total) / count;
    return '<div class="tool-row"><div><strong>' + escapeHtml(item.title) + ' · ' + escapeHtml(item.circleName) + '</strong><small>' + escapeHtml(item.createdByName) + ' paid ' + money(item.total) + ' · ' + count + ' people · about ₹' + share.toLocaleString("en-IN", { maximumFractionDigits: 2 }) + ' each</small></div><button class="tool-action" data-split-iou="' + escapeHtml(item.id) + '" aria-label="Record your share for ' + escapeHtml(item.title) + '">My IOU</button></div>';
  }).join("") : '<div class="empty">Shared circle costs will appear here.</div>';
  const debtList = $("debtList");
  if (debtList) {
    const open = debtItems.filter((item) => !item.settled);
    const receivable = open.filter((item) => item.direction === "owed-to-me").reduce((sum, item) => sum + Number(item.amount), 0);
    const payable = open.filter((item) => item.direction === "i-owe").reduce((sum, item) => sum + Number(item.amount), 0);
    $("debtSummary").textContent = "They owe you " + money(receivable) + " · You owe " + money(payable);
    debtList.innerHTML = debtItems.length ? debtItems.map((item) => '<div class="tool-row ' + (item.settled ? "settled" : "") + '"><div><strong>' + escapeHtml(item.person) + ' · ' + escapeHtml(item.direction === "owed-to-me" ? "owes you" : "you owe") + '</strong><small>' + escapeHtml(item.note || "Shared cost") + (item.settled ? " · settled" : "") + '</small></div><b>' + money(item.amount) + '</b><button class="tool-action" data-tool-action="settle" data-id="' + escapeHtml(item.id) + '" aria-label="' + (item.settled ? "Reopen" : "Mark settled") + ' IOU">' + (item.settled ? "Reopen" : "Settle") + '</button><button class="tool-delete" data-tool-delete="debts" data-id="' + escapeHtml(item.id) + '" aria-label="Delete IOU with ' + escapeHtml(item.person) + '">×</button></div>').join("") : '<div class="empty">No IOUs yet.</div>';
  }
}
function checkLocalBillReminders(items) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (user && localStorage.getItem("moonledger-push-token-" + user.uid)) return;
  for (const item of items) {
    if (![1, 3].includes(item.days)) continue;
    const key = "moonledger-bill-reminder-" + item.id + "-" + currentDayKey();
    if (localStorage.getItem(key)) continue;
    localStorage.setItem(key, "sent");
    new Notification("Upcoming " + (item.kind === "subscription" ? "subscription" : "bill") + " · " + item.name, { body: money(item.amount) + " due in " + item.days + (item.days === 1 ? " day." : " days."), icon: "/moonledger-icon-192.png" });
  }
}

function renderInsights() {
  const [year, month] = (monthSelect.value || "").split("-").map(Number);
  const items = expenses.filter((entry) => { const date = new Date(entry.date); return date.getFullYear() === year && date.getMonth() + 1 === month; });
  const deliveryCount = items.filter((entry) => entry.category === "Food delivery").length;
  const biggest = items.slice().sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  const weekendSpend = items.filter((entry) => [0, 6].includes(new Date(entry.date).getDay())).reduce((sum, entry) => sum + Number(entry.amount), 0);
  const weekdaySpend = items.filter((entry) => ![0, 6].includes(new Date(entry.date).getDay())).reduce((sum, entry) => sum + Number(entry.amount), 0);
  $("insightText").textContent = deliveryCount >= 3 ? "You ordered food " + deliveryCount + " times this month. Small changes can make a noticeable difference." : weekendSpend > weekdaySpend && items.length >= 4 ? "Your weekend spending is higher than your weekday spending so far this month." : biggest ? "Your biggest logged spend is " + (biggest.note || biggest.category) + " at " + money(biggest.amount) + "." : "Add a few spends and Moonledger will find a useful pattern for you.";
  let streak = 0; const today = new Date(); const streakStart = noSpendDates.includes(currentDayKey(today)) ? 0 : 1;
  for (let offset = streakStart; offset < streakStart + 365; offset++) { const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset, 12); if (noSpendDates.includes(currentDayKey(day))) streak++; else break; }
  $("streakText").textContent = "No-spend streak: " + streak + (streak === 1 ? " day" : " days");
  $("markNoSpend").disabled = noSpendDates.includes(currentDayKey());
  $("markNoSpend").textContent = $("markNoSpend").disabled ? "Today marked no-spend" : "I spent nothing today";
}

function renderQuickAdds() {
  const container = $("quickAddList");
  if (!container) return;
  const cutoff = Date.now() - 90 * 86400000;
  const grouped = new Map();
  expenses.filter((entry) => entry.note && Number(entry.amount) > 0 && new Date(entry.date).getTime() >= cutoff).forEach((entry) => {
    const key = [entry.note.trim().toLowerCase(), Number(entry.amount), entry.category, entry.method].join("|");
    const item = grouped.get(key) || { ...entry, count: 0, latest: 0 };
    item.count += 1; item.latest = Math.max(item.latest, new Date(entry.date).getTime());
    grouped.set(key, item);
  });
  const common = Array.from(grouped.values()).sort((a, b) => b.count - a.count || b.latest - a.latest);
  const preferred = readQuickPresets();
  const quicks = [...preferred, ...common].filter((entry, index, all) => all.findIndex((item) => item.note?.toLowerCase() === entry.note?.toLowerCase() && Number(item.amount) === Number(entry.amount)) === index).slice(0, 4);
  container.replaceChildren();
  $("quickAdds").hidden = quicks.length === 0;
  quicks.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "quick-add-chip";
    button.textContent = entry.note + " · " + money(entry.amount);
    button.title = "Add " + entry.note + " expense with one tap";
    button.setAttribute("aria-label", button.title + ", " + money(entry.amount));
    button.onclick = async () => {
      button.disabled = true;
      const data = { amount: Number(entry.amount), method: entry.method || "UPI", category: entry.category || "Other", note: entry.note, date: dateFromInput(dateInputValue()) };
      try {
        if (guestMode) {
          expenses = [{ id: "guest_" + (crypto.randomUUID?.() || Date.now() + "_" + Math.random().toString(36).slice(2)), ...data }, ...expenses];
          saveGuestExpenses(); render();
        } else if (user) await addDoc(userCollection("expenses"), data);
        $("quickEntryStatus").textContent = "Added " + entry.note + " · " + money(entry.amount) + ".";
      } catch (error) {
        $("quickEntryStatus").textContent = "Could not add that spend: " + error.message;
      } finally { button.disabled = false; }
    };
    container.append(button);
  });
}

function guessCategory(text) {
  const value = text.toLowerCase();
  if (/swiggy|zomato|food delivery|food order/.test(value)) return "Food delivery";
  if (/blinkit|zepto|bigbasket|grocery|groceries|vegetable|supermarket/.test(value)) return "Groceries";
  if (/rent|landlord/.test(value)) return "Rent";
  if (/netflix|spotify|subscription|prime video|hotstar|gym/.test(value)) return "Subscriptions";
  if (/auto|uber|ola|metro|bus|commute|fuel|petrol|cab/.test(value)) return "Commute";
  if (/movie|cinema|cafe|pub|outing|date night/.test(value)) return "Going out";
  if (/electricity|wifi|internet|phone bill|recharge|gas bill/.test(value)) return "Bills";
  if (/doctor|medicine|pharmacy|clinic/.test(value)) return "Health";
  if (/shopping|clothes|shoes/.test(value)) return "Shopping";
  if (/chai|tea|coffee|lunch|dinner|breakfast|snack|restaurant|meal/.test(value)) return "Food & drink";
  return "Other";
}

function ensureExpenseMonthOptions(entries) {
  const known = new Set(Array.from(monthSelect.options, (option) => option.value));
  entries.forEach((entry) => {
    if (!entry.date) return;
    const date = new Date(entry.date);
    const value = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
    if (!known.has(value)) {
      const option = document.createElement("option");
      option.value = value; option.textContent = date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
      monthSelect.add(option); known.add(value);
    }
  });
  const selected = monthSelect.value;
  Array.from(monthSelect.options).sort((a, b) => b.value.localeCompare(a.value)).forEach((option) => monthSelect.append(option));
  monthSelect.value = selected;
}

function renderContent() {
  ensureExpenseMonthOptions(expenses);
  if (!monthSelect.value) return;
  renderQuickAdds();
  const parts = monthSelect.value.split("-").map(Number);
  const monthItems = expenses.filter((entry) => {
    const date = new Date(entry.date);
    return date.getFullYear() === parts[0] && date.getMonth() + 1 === parts[1];
  });
  const total = monthItems.reduce((sum, entry) => sum + Number(entry.amount), 0);
  $("monthTotal").textContent = money(total);
  $("countTotal").textContent = String(monthItems.length);
  const week = expenses.filter((entry) => {
    const age = Date.now() - new Date(entry.date).getTime();
    return age >= 0 && age < 7 * 86400000;
  }).reduce((sum, entry) => sum + Number(entry.amount), 0);
  $("weekTotal").textContent = money(week);
  $("monthCompare").textContent = monthItems.length
    ? monthItems.length + (monthItems.length === 1 ? " expense recorded" : " expenses recorded")
    : "Start with your first expense";
  const todayKey = currentDayKey();
  const isHome = currentView === "Overview";
  let visibleItems = isHome ? monthItems.filter((entry) => currentDayKey(new Date(entry.date)) === todayKey) : monthItems;
  if (currentView === "Expenses" && expenseMethodFilter !== "all") visibleItems = visibleItems.filter((entry) => entry.method === expenseMethodFilter);
  if (currentView === "Expenses" && expenseCategoryFilter !== "all") visibleItems = visibleItems.filter((entry) => entry.category === expenseCategoryFilter);
  if (currentView === "Expenses" && expenseSearchText) visibleItems = visibleItems.filter((entry) => (entry.note + " " + entry.category + " " + entry.method).toLowerCase().includes(expenseSearchText));
  const sorted = visibleItems.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const list = $("expenseList");
  list.replaceChildren();
  if (!sorted.length) list.innerHTML = isHome
    ? '<div class="empty">Nothing here yet. Add a spend whenever you’re ready.</div>'
    : '<div class="empty">No matching spends yet. Try another search or add an expense.</div>';
  const listEntries = sorted.slice(0, showAll ? 100 : isHome ? 4 : 40);
  let lastDay = "";
  listEntries.forEach((entry) => {
    const day = currentDayKey(new Date(entry.date));
    if (!isHome && day !== lastDay) {
      const dayItems = listEntries.filter((item) => currentDayKey(new Date(item.date)) === day);
      const dayTotal = dayItems.reduce((sum, item) => sum + Number(item.amount), 0);
      const group = document.createElement("div"); group.className = "day-group";
      group.innerHTML = '<div class="day-heading"><span>' + new Date(entry.date).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" }) + '</span><span>' + money(dayTotal) + '</span></div>';
      list.append(group); lastDay = day;
    }
    const row = document.createElement("div");
    row.className = "expense";
    row.innerHTML = '<div class="eicon">' + (icons[entry.category] || "·") + '</div><div class="edesc"><strong>' + escapeHtml(entry.note || entry.category) + '</strong><small>' + new Date(entry.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + " · " + escapeHtml(entry.method) + " · " + escapeHtml(entry.category) + '</small></div><div class="eamount">−' + money(entry.amount) + '</div><div class="expense-actions"><button type="button" data-expense-action="edit" data-expense-id="' + escapeHtml(entry.id) + '" aria-label="Edit ' + escapeHtml(entry.note || entry.category) + '">Edit</button><button type="button" data-expense-action="delete" data-expense-id="' + escapeHtml(entry.id) + '" aria-label="Delete ' + escapeHtml(entry.note || entry.category) + '">Delete</button></div>';
    if (!isHome) list.lastElementChild?.append(row); else list.append(row);
  });
  const totals = {};
  monthItems.forEach((entry) => { totals[entry.category] = (totals[entry.category] || 0) + Number(entry.amount); });
  const categories = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 4);
  $("categories").innerHTML = categories.length
    ? categories.map(([name, amount]) => '<div class="category"><div class="cat-head"><span>' + escapeHtml(name) + '</span><small>' + money(amount) + '</small></div><div class="bar"><i style="width:' + Math.max(4, Math.round(amount / total * 100)) + '%"></i></div></div>').join("")
    : '<div class="empty">Your category breakdown will show up here.</div>';
  const palette = ["#68e2cc", "#9680ff", "#ef84c8", "#ffc66d", "#72b8ff", "#f28d7d", "#70d9e8"];
  let cursor = 0;
  const allCategories = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const arcs = allCategories.map(([, amount], index) => { const start = cursor; cursor += total ? amount / total * 100 : 0; return palette[index % palette.length] + " " + start + "% " + cursor + "%"; });
  $("reportDonut").style.background = arcs.length ? "conic-gradient(" + arcs.join(",") + ")" : "conic-gradient(#ffffff18 0 100%)";
  $("reportTotal").textContent = money(total);
  const byWeekday = Array.from({ length: 7 }, () => 0);
  monthItems.forEach((entry) => { byWeekday[new Date(entry.date).getDay()] += Number(entry.amount); });
  const maxDay = Math.max(...byWeekday, 1);
  $("weeklyBars").innerHTML = byWeekday.map((amount, day) => '<div class="week-bar ' + (day === 0 || day === 6 ? "weekend" : "") + '" aria-label="' + ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day] + " " + money(amount) + '"><i style="height:' + Math.max(4, amount / maxDay * 65) + 'px"></i><small>' + ["S", "M", "T", "W", "T", "F", "S"][day] + '</small></div>').join("");
}

function render() { renderContent(); updateBudget(); syncChallengeSummary(); renderLeaderboard(); renderTools(); renderInsights(); }
function updateBudget() {
  if (!monthSelect.value) return;
  const month = monthSelect.value;
  const parts = month.split("-").map(Number);
  const budget = Number(budgets[month] || 0);
  const spent = expenses.filter((entry) => {
    const date = new Date(entry.date);
    return date.getFullYear() === parts[0] && date.getMonth() + 1 === parts[1];
  }).reduce((sum, entry) => sum + Number(entry.amount), 0);
  $("budgetCaption").textContent = new Date(parts[0], parts[1] - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  $("leaderPeriod").textContent = $("budgetCaption").textContent;
  const now = new Date();
  const currentMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  $("dailySafeCard").classList.toggle("has-budget", Boolean(budget) && month === currentMonth);
  $("dailySafeCard").style.setProperty("--budget-progress", Math.min(100, budget ? spent / budget * 100 : 0) + "%");
  $("dailySafeSetBudget").hidden = Boolean(budget);
  if (!budget) {
    $("budgetEmpty").hidden = false; $("budgetProgress").hidden = true; $("setBudget").hidden = false; $("budgetNumbers").textContent = "";
    $("dailySafeAmount").textContent = "—";
    $("dailySafeNote").textContent = month === currentMonth ? "Set a monthly budget to get your daily guide." : "Choose the current month and set a budget to get your daily guide.";
    return;
  }
  $("budgetEmpty").hidden = true; $("budgetProgress").hidden = false; $("setBudget").hidden = true;
  $("budgetNumbers").textContent = money(spent) + " / " + money(budget);
  const ratio = spent / budget;
  $("budgetFill").style.width = Math.min(100, Math.max(0, ratio * 100)) + "%";
  $("budgetFill").className = "budget-fill" + (ratio >= 1 ? " over" : ratio >= 0.8 ? " warn" : "");
  $("budgetStatus").textContent = ratio >= 1 ? "Over budget by " + money(spent - budget) : money(budget - spent) + " left · " + Math.round(ratio * 100) + "% used";
  $("budgetStatus").style.color = ratio >= 1 ? "#b86678" : "";
  if (month === currentMonth) {
    const storedPayday = localStorage.getItem(paydayStorageKey());
    const configuredDay = storedPayday ? Number(storedPayday.split("-")[2]) : 0;
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const paydayDay = configuredDay || monthEnd;
    let nextPayday = new Date(now.getFullYear(), now.getMonth(), Math.min(paydayDay, monthEnd), 12);
    if (nextPayday < now) { const nextMonthLastDay = new Date(now.getFullYear(), now.getMonth() + 2, 0).getDate(); nextPayday = new Date(now.getFullYear(), now.getMonth() + 1, Math.min(paydayDay, nextMonthLastDay), 12); }
    const daysLeft = Math.max(1, Math.ceil((nextPayday - now) / 86400000) + 1);
    const remaining = Math.max(0, budget - spent);
    $("dailySafeAmount").textContent = money(Math.floor(remaining / Math.max(daysLeft, 1)));
    const ringColor = ratio >= 1 ? "#ff827e" : ratio >= 0.8 ? "#ffc45c" : "#6de5bd";
    $("dailySafeCard").style.setProperty("--ring-color", ringColor);
    $("dailySafeNote").textContent = remaining ? money(remaining) + " left · " + daysLeft + (daysLeft === 1 ? " day" : " days") + (configuredDay ? " to payday · you're on track" : " left this month") : "You’ve reached this month’s budget. Adjust it if your plans changed.";
  } else {
    $("dailySafeAmount").textContent = "—";
    $("dailySafeNote").textContent = "Choose the current month to see a daily spending guide.";
  }
}

function dateInputValue(value = new Date()) {
  const date = new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function dateFromInput(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12).toISOString();
}
function openExpenseModal(entry = null) {
  editingExpenseId = entry?.id || null;
  $("expenseForm").reset();
  method = entry?.method || "UPI";
  $("amount").value = entry?.amount ?? "";
  $("note").value = entry?.note || "";
  $("category").value = entry?.category || "Food & drink";
  $("expenseDate").value = dateInputValue(entry?.date || new Date());
  $("expenseDate").max = dateInputValue();
  $("expenseModalTitle").textContent = editingExpenseId ? "Edit expense" : "Add an expense";
  $("saveExpenseBtn").textContent = editingExpenseId ? "Save changes" : "Save expense";
  document.querySelectorAll("[data-method]").forEach((choice) => choice.classList.toggle("selected", choice.dataset.method === method));
  renderCategoryChips(); syncDateChoices();
  $("modal").classList.add("open"); setTimeout(() => $("amount").focus(), 30);
}
function closeExpenseModal() { $("modal").classList.remove("open"); editingExpenseId = null; }
$("addBtn").onclick = openExpenseModal;
$("mobileAddBtn").onclick = openExpenseModal;
$("cancelBtn").onclick = closeExpenseModal;
$("allBtn").onclick = () => { showAll = !showAll; $("allBtn").textContent = showAll ? "Show less" : currentView === "Expenses" ? "Show all" : "See all"; render(); };
$("expenseList").onclick = async (event) => {
  const button = event.target.closest("[data-expense-action]");
  if (!button) return;
  const entry = expenses.find((item) => item.id === button.dataset.expenseId);
  if (!entry) return;
  if (button.dataset.expenseAction === "edit") { openExpenseModal(entry); return; }
  if (!confirm("Delete “" + (entry.note || entry.category) + "” for " + money(entry.amount) + "?")) return;
  try {
    if (guestMode) {
      expenses = expenses.filter((item) => item.id !== entry.id); saveGuestExpenses(); render();
      const guestData = readGuestData();
      if (guestData.uploadedExpenseIds.includes(entry.id)) {
        guestData.uploadedExpenseIds = guestData.uploadedExpenseIds.filter((id) => id !== entry.id);
        guestData.syncedExpenseIds = guestData.syncedExpenseIds.filter((id) => id !== entry.id);
        guestData.deletedExpenseIds = Array.from(new Set([...guestData.deletedExpenseIds, entry.id]));
        writeGuestData(guestData);
      }
    } else if (user) {
      await deleteDoc(doc(userCollection("expenses"), entry.id));
    }
  } catch (error) { alert("This expense could not be deleted. " + error.message); }
};
$("quickEntryForm").onsubmit = (event) => {
  event.preventDefault();
  const raw = $("quickEntryText").value.trim();
  const parsed = parseExpenseText(raw);
  if (!parsed) { $("quickEntryStatus").textContent = "Add an amount, like ‘250 Swiggy dinner’."; return; }
  $("quickEntryStatus").textContent = "Filled a draft — check the details, then save.";
  openExpenseModal({ ...parsed, date: new Date().toISOString() });
};

function openSharedTextIfPresent() {
  if (!sharedText || (!user && !guestMode)) return;
  const parsed = parseExpenseText(sharedText);
  if (parsed) {
    $("quickEntryStatus").textContent = "Shared message parsed on this device. Review the draft before saving.";
    openExpenseModal({ ...parsed, date: new Date().toISOString() });
  } else {
    $("smsText").value = sharedText;
    $("smsStatus").textContent = "Shared text is ready. It stays on this device until you choose to save a draft.";
    $("smsText").closest("details").open = true;
  }
  sharedText = "";
}
$("parseSms").onclick = () => {
  const raw = $("smsText").value;
  const parsed = parseExpenseText(raw);
  if (!parsed) { $("smsStatus").textContent = "Couldn’t find an amount. Check the message and fill the form yourself."; return; }
  const dateMatch = raw.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  let date = new Date().toISOString();
  if (dateMatch) { const year = Number(dateMatch[3].length === 2 ? "20" + dateMatch[3] : dateMatch[3]); date = new Date(year, Number(dateMatch[2]) - 1, Number(dateMatch[1]), 12).toISOString(); }
  $("smsStatus").textContent = "Parsed on this device. Review everything before saving.";
  openExpenseModal({ ...parsed, date });
};
  monthSelect.onchange = () => { watchBudget(monthSelect.value); watchChallengeMembers(); render(); };
document.querySelectorAll("[data-method]").forEach((button) => button.onclick = () => {
  method = button.dataset.method;
  document.querySelectorAll("[data-method]").forEach((choice) => choice.classList.toggle("selected", choice === button));
});

function renderCategoryChips() {
  const select = $("category"), container = $("categoryChips");
  if (!select || !container) return;
  container.replaceChildren();
  Array.from(select.options).forEach((option) => {
    const chip = document.createElement("button");
    chip.type = "button"; chip.className = "category-chip";
    chip.textContent = (icons[option.value] || "·") + " " + option.value;
    chip.classList.toggle("selected", option.value === select.value);
    chip.setAttribute("aria-pressed", String(option.value === select.value));
    chip.onclick = () => { select.value = option.value; renderCategoryChips(); };
    container.append(chip);
  });
  select.classList.add("category-select-hidden");
}
function syncDateChoices() {
  const input = $("expenseDate"), value = input.value;
  const today = dateInputValue(), yesterdayDate = new Date(); yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = dateInputValue(yesterdayDate);
  document.querySelectorAll("[data-date-choice]").forEach((button) => button.classList.toggle("selected", value === today || value === yesterday ? button.dataset.dateChoice === (value === yesterday ? "yesterday" : "today") : false));
  input.max = today;
}
document.querySelectorAll("[data-date-choice]").forEach((button) => button.onclick = () => {
  const day = new Date(); if (button.dataset.dateChoice === "yesterday") day.setDate(day.getDate() - 1);
  $("expenseDate").value = dateInputValue(day); syncDateChoices();
});
$("expenseDate").addEventListener("change", syncDateChoices);
$("category").addEventListener("change", renderCategoryChips);
$("amountPad").addEventListener("click", (event) => {
  const key = event.target.closest("[data-digit]")?.dataset.digit;
  if (!key) return;
  const input = $("amount");
  if (key === "clear") input.value = "";
  else if (key === "back") input.value = input.value.slice(0, -1);
  else input.value = (input.value || "") + key;
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
$("expenseSearch").addEventListener("input", (event) => { expenseSearchText = event.target.value.trim().toLowerCase(); render(); });
$("expenseCategoryFilter").addEventListener("change", (event) => { expenseCategoryFilter = event.target.value; render(); });
document.querySelectorAll("[data-expense-filter]").forEach((button) => button.onclick = () => {
  expenseMethodFilter = button.dataset.expenseFilter;
  document.querySelectorAll("[data-expense-filter]").forEach((item) => { item.classList.toggle("active", item === button); item.setAttribute("aria-pressed", String(item === button)); });
  render();
});

$("expenseForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!user && !guestMode) return;
  const amount = Number($("amount").value);
  if (!amount || amount <= 0 || !$("expenseDate").value) return;
  const entryData = { amount, method, category: $("category").value, note: $("note").value.trim(), date: dateFromInput($("expenseDate").value) };
  try {
    let createdId = null;
    if (guestMode) {
      if (editingExpenseId) expenses = expenses.map((entry) => entry.id === editingExpenseId ? { ...entry, ...entryData } : entry);
      else expenses = [{ id: "guest_" + (crypto.randomUUID?.() || Date.now() + "_" + Math.random().toString(36).slice(2)), ...entryData }, ...expenses];
      if (!editingExpenseId) createdId = expenses[0].id;
      if (editingExpenseId) {
        const guestData = readGuestData();
        guestData.syncedExpenseIds = guestData.syncedExpenseIds.filter((id) => id !== editingExpenseId);
        writeGuestData(guestData);
      }
      saveGuestExpenses(); render();
    } else if (editingExpenseId) {
      await updateDoc(doc(userCollection("expenses"), editingExpenseId), entryData);
    } else {
      const saved = await addDoc(userCollection("expenses"), entryData); createdId = saved.id;
    }
    event.target.reset(); method = "UPI";
    closeExpenseModal();
    if (!editingExpenseId && createdId) { lastCreatedExpense = { id: createdId, ...entryData }; showSaveToast(); }
  } catch (error) { alert("This expense could not be saved. Your current details are still in the form. " + error.message); }
};

function openBudgetModal() {
  const parts = monthSelect.value.split("-").map(Number);
  $("budgetModalMonth").textContent = "Set a target for " + new Date(parts[0], parts[1] - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) + ".";
  $("budgetAmount").value = budgets[monthSelect.value] || "";
  $("budgetModal").classList.add("open"); setTimeout(() => $("budgetAmount").focus(), 30);
}
function closeBudgetModal() { $("budgetModal").classList.remove("open"); }
$("setBudget").onclick = openBudgetModal; $("editBudget").onclick = openBudgetModal; $("cancelBudget").onclick = closeBudgetModal;
$("dailySafeSetBudget").onclick = openBudgetModal;
$("budgetForm").onsubmit = async (event) => {
  event.preventDefault();
  const amount = Number($("budgetAmount").value);
  if (!amount || amount <= 0 || (!user && !guestMode)) return;
  try {
    if (guestMode) {
      const data = readGuestData();
      if (data.syncedBudgetMonths.includes(monthSelect.value)) {
        data.syncedBudgetMonths = data.syncedBudgetMonths.filter((month) => month !== monthSelect.value);
        data.overwriteBudgetMonths = Array.from(new Set([...data.overwriteBudgetMonths, monthSelect.value]));
      }
      data.budgets[monthSelect.value] = amount; writeGuestData(data); budgets = data.budgets; updateBudget();
    } else {
      const save = setDoc(doc(userCollection("budgets"), monthSelect.value), { amount, updatedAt: new Date().toISOString() });
      save.catch((error) => alert("This budget could not sync to your account. " + error.message));
    }
    closeBudgetModal();
  } catch (error) { alert("The budget could not be saved. " + error.message); }
};

$("importBackup").onclick = () => $("backupFile").click();
$("backupFile").onchange = async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || !user) return;
  if (!navigator.onLine) { alert("Connect to the internet before importing a backup."); return; }
  try {
    const backup = JSON.parse(await file.text());
    if (backup.format !== "moonledger-backup-v1" || !Array.isArray(backup.expenses) || typeof backup.budgets !== "object") {
      throw new Error("This file is not a Moonledger backup.");
    }
    const validCategories = ["Food & drink", "Food delivery", "Groceries", "Commute", "Rent", "Subscriptions", "Going out", "Travel", "Shopping", "Bills", "Health", "Home", "Entertainment", "Other"];
    const validMethods = ["UPI", "Cash", "Card"];
    const records = backup.expenses.map((entry, index) => {
      const amount = Number(entry.amount);
      const category = validCategories.includes(entry.category) ? entry.category : "Other";
      const methodValue = validMethods.includes(entry.method) ? entry.method : "UPI";
      const date = new Date(entry.date || Date.now()).toISOString();
      if (!(amount > 0)) throw new Error("A backup entry has an invalid amount.");
      const stableId = String(entry.id || (date + "-" + amount + "-" + index)).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
      return { id: "backup_" + stableId, data: { amount, method: methodValue, category, note: String(entry.note || "").slice(0, 80), date, importedFromPrototype: true } };
    });
    const budgetEntries = Object.entries(backup.budgets || {}).filter(([month, amount]) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && Number(amount) > 0);
    if (!confirm("Import " + records.length + " expenses and " + budgetEntries.length + " budgets into " + (user.email || "this Gmail account") + "? This uploads them to your private Moonledger account.")) return;
    const expenseRef = userCollection("expenses");
    for (let start = 0; start < records.length; start += 400) {
      const batch = writeBatch(getDatabase());
      records.slice(start, start + 400).forEach((record) => batch.set(doc(expenseRef, record.id), record.data));
      await batch.commit();
    }
    if (budgetEntries.length) {
      const batch = writeBatch(getDatabase());
      budgetEntries.forEach(([month, amount]) => batch.set(doc(userCollection("budgets"), month), { amount: Number(amount), updatedAt: new Date().toISOString() }));
      await batch.commit();
    }
    $("cloudStatus").textContent = "Backup imported to your private account.";
  } catch (error) {
    alert("The backup could not be imported. The original backup file is unchanged. " + error.message);
  }
};

function saveToolLocal(key, value) {
  const data = readGuestData(); data[key] = value; writeGuestData(data);
}
$("recurringForm").onsubmit = async (event) => {
  event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form);
  const item = { name: String(fields.get("name")).trim().slice(0, 50), amount: Number(fields.get("amount")), dueDay: Number(fields.get("dueDay")), kind: String(fields.get("kind")), enabled: true };
  if (!item.name || item.amount <= 0 || item.dueDay < 1 || item.dueDay > 31) return;
  try {
    if (guestMode) { recurringItems = [{ id: "local_" + crypto.randomUUID(), ...item }, ...recurringItems]; saveToolLocal("recurringItems", recurringItems); renderTools(); }
    else if (user) await addDoc(userCollection("recurring"), item);
    form.reset();
  } catch (error) { alert("Could not save this bill. " + error.message); }
};
$("debtForm").onsubmit = async (event) => {
  event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form);
  const item = { person: String(fields.get("person")).trim().slice(0, 50), amount: Number(fields.get("amount")), note: String(fields.get("note") || "").trim().slice(0, 80), direction: String(fields.get("direction")), settled: false, createdAt: new Date().toISOString() };
  if (!item.person || item.amount <= 0) return;
  try {
    if (guestMode) { debtItems = [{ id: "local_" + crypto.randomUUID(), ...item }, ...debtItems]; saveToolLocal("debtItems", debtItems); renderTools(); }
    else if (user) await addDoc(userCollection("debts"), item);
    form.reset();
  } catch (error) { alert("Could not save this IOU. " + error.message); }
};
document.addEventListener("click", async (event) => {
  const remove = event.target.closest("[data-tool-delete]");
  const action = event.target.closest("[data-tool-action]");
  if (!remove && !action) return;
  const type = remove ? remove.dataset.toolDelete : "debts"; const id = (remove || action).dataset.id;
  try {
    if (guestMode) {
      if (remove && type === "recurring") recurringItems = recurringItems.filter((item) => item.id !== id);
      else if (remove) debtItems = debtItems.filter((item) => item.id !== id);
      else debtItems = debtItems.map((item) => item.id === id ? { ...item, settled: !item.settled } : item);
      saveToolLocal(remove && type === "recurring" ? "recurringItems" : "debtItems", remove && type === "recurring" ? recurringItems : debtItems); renderTools();
    } else if (user) {
      if (remove) await deleteDoc(doc(userCollection(type), id));
      else { const item = debtItems.find((row) => row.id === id); if (item) await updateDoc(doc(userCollection("debts"), id), { settled: !item.settled }); }
    }
  } catch (error) { alert("Could not update this item. " + error.message); }
});
$("sharedSplitForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!user) { alert("Sign in and create or join a savings circle to share costs with its members."); return; }
  const fields = new FormData(event.currentTarget); const circleId = $("sharedSplitCircle").value; const circle = joinedChallenges.find((item) => item.id === circleId);
  const members = challengeMemberData.filter((item) => item.challengeId === circleId);
  if (!circle) { alert("Create or join a savings circle first."); return; }
  if (members.length < 2) { alert("Invite at least one other person to this circle before splitting a cost."); return; }
  if (members.length > 20) { alert("Even splits currently support up to 20 circle members."); return; }
  try {
    await addDoc(collection(getDatabase(), "challenges", circleId, "splits"), { title: String(fields.get("title")).trim().slice(0,60), total: Number(fields.get("total")), participantCount: members.length, createdBy: user.uid, createdByName: (user.displayName || user.email?.split("@")[0] || "Moonledger user").slice(0,40), createdAt: new Date().toISOString() });
    event.currentTarget.reset();
  } catch (error) { alert("Could not share this circle cost. " + error.message); }
};
$("sharedSplitList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-split-iou]"); if (!button || !user) return;
  const split = sharedSplits.find((item) => item.id === button.dataset.splitIou); if (!split) return;
  const existing = debtItems.find((item) => item.splitId === split.id);
  if (existing) { alert("This shared cost is already in your personal IOU list."); return; }
  const share = Number(split.total) / Math.max(1, Number(split.participantCount));
  try {
    if (split.createdBy === user.uid) {
      const members = challengeMemberData.filter((item) => item.challengeId === split.challengeId && item.id !== user.uid);
      if (!members.length) { alert("No other circle member is available for this split yet."); return; }
      const batch = writeBatch(getDatabase());
      members.forEach((member) => batch.set(doc(userCollection("debts"), "split_" + split.id + "_" + member.id), { person: String(member.displayName || "Circle member").slice(0,50), amount: share, note: ("Split: " + split.title).slice(0,80), direction: "owed-to-me", settled: false, createdAt: new Date().toISOString(), splitId: split.id }));
      await batch.commit();
    } else {
      await setDoc(doc(userCollection("debts"), "split_" + split.id + "_" + user.uid), { person: String(split.createdByName || "Circle member").slice(0,50), amount: share, note: ("Split: " + split.title).slice(0,80), direction: "i-owe", settled: false, createdAt: new Date().toISOString(), splitId: split.id });
    }
    alert("Your share was added to your private IOU list.");
  } catch (error) { alert("Could not add your share to IOUs. " + error.message); }
});
$("markNoSpend").onclick = async () => {
  const today = currentDayKey(); if (noSpendDates.includes(today)) return;
  if (expenses.some((entry) => currentDayKey(new Date(entry.date)) === today)) { alert("You have an expense logged for today. Review it before marking today as no-spend."); return; }
  try {
    if (guestMode) { noSpendDates = [...noSpendDates, today]; saveToolLocal("noSpendDates", noSpendDates); renderInsights(); }
    else if (user) { await setDoc(doc(userCollection("noSpendDays"), today), { date: today }); }
  } catch (error) { alert("Could not save your no-spend check-in. " + error.message); }
};
$("startChallenge").onclick = async () => {
  const today = currentDayKey(); let startedAt = "";
  try {
    if (user) {
      const ref = doc(userCollection("challengeProgress"), "no-spend-7"); const snapshot = await getDoc(ref);
      startedAt = snapshot.exists() ? snapshot.data().startDate : "";
      const elapsedBeforeRestart = startedAt ? Math.floor((new Date(today + "T12:00:00") - new Date(startedAt + "T12:00:00")) / 86400000) : 0;
      if (!startedAt || elapsedBeforeRestart >= 7) { startedAt = today; await setDoc(ref, { type: "no-spend-7", startDate: startedAt }); }
    } else {
      const data = readGuestData(); startedAt = data.noSpendChallengeStart || "";
      const elapsedBeforeRestart = startedAt ? Math.floor((new Date(today + "T12:00:00") - new Date(startedAt + "T12:00:00")) / 86400000) : 0;
      if (!startedAt || elapsedBeforeRestart >= 7) { startedAt = today; saveToolLocal("noSpendChallengeStart", startedAt); }
    }
    const elapsed = Math.floor((new Date(today + "T12:00:00") - new Date(startedAt + "T12:00:00")) / 86400000);
    alert("Your 7-day no-spend challenge is on · day " + Math.min(elapsed + 1, 7) + " of 7. Mark no-spend days only when you spent nothing.");
  } catch (error) { alert("Could not save the challenge. " + error.message); }
};
function exportCurrentCsv() {
  const [year, month] = monthSelect.value.split("-").map(Number);
  const rows = expenses.filter((entry) => { const date = new Date(entry.date); return date.getFullYear() === year && date.getMonth() + 1 === month; });
  const blob = new Blob([makeExpenseCsv(rows)], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = "moonledger-" + monthSelect.value + ".csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("exportCsv").onclick = exportCurrentCsv;
function makeRecapCanvas() {
  const [year, month] = monthSelect.value.split("-").map(Number); const rows = expenses.filter((entry) => { const d = new Date(entry.date); return d.getFullYear() === year && d.getMonth() + 1 === month; });
  const totals = {}; rows.forEach((entry) => totals[entry.category] = (totals[entry.category] || 0) + Number(entry.amount));
  const top = Object.entries(totals).sort((a,b)=>b[1]-a[1])[0]; const biggest = rows.slice().sort((a,b)=>Number(b.amount)-Number(a.amount))[0];
  const marked = new Set(noSpendDates.filter((key) => key.startsWith(monthSelect.value)));
  const canvas = document.createElement("canvas"); canvas.width = 1080; canvas.height = 1920; const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0,0,1080,1920); gradient.addColorStop(0,"#232344"); gradient.addColorStop(1,"#11111c"); ctx.fillStyle = gradient; ctx.fillRect(0,0,1080,1920);
  ctx.fillStyle = "#d9d0ff"; ctx.font = "700 42px sans-serif"; ctx.fillText("☾  moonledger", 88, 145);
  ctx.fillStyle = "#a9a8c3"; ctx.font = "500 32px sans-serif"; ctx.fillText(new Date(year,month-1,1).toLocaleDateString("en-IN",{month:"long",year:"numeric"}),88,260);
  ctx.fillStyle = "#ffffff"; ctx.font = "700 64px sans-serif"; ctx.fillText("My month, in view.",88,370);
  ctx.fillStyle = "#a9a8c3"; ctx.font = "500 30px sans-serif"; ctx.fillText("Total logged",88,500);
  ctx.fillStyle = "#ffffff"; ctx.font = "800 96px sans-serif"; ctx.fillText(money(rows.reduce((sum,row)=>sum+Number(row.amount),0)),88,615);
  ctx.fillStyle = "#a9a8c3"; ctx.font = "500 30px sans-serif"; ctx.fillText("Top category",88,800);
  ctx.fillStyle = "#ffffff"; ctx.font = "700 48px sans-serif"; ctx.fillText(top ? top[0] + " · " + money(top[1]) : "No entries yet",88,870);
  ctx.fillStyle = "#a9a8c3"; ctx.font = "500 30px sans-serif"; ctx.fillText("No-spend days · confirmed by me",88,1040);
  ctx.fillStyle = "#ffffff"; ctx.font = "700 56px sans-serif"; ctx.fillText(marked.size + " days",88,1110);
  ctx.fillStyle = "#a9a8c3"; ctx.font = "500 30px sans-serif"; ctx.fillText("Biggest logged spend",88,1280);
  ctx.fillStyle = "#ffffff"; ctx.font = "700 42px sans-serif"; ctx.fillText(biggest ? (biggest.note || biggest.category) + " · " + money(biggest.amount) : "—",88,1350);
  ctx.fillStyle = "#a9a8c3"; ctx.font = "500 27px sans-serif"; ctx.fillText("A personal snapshot. Share only if you want to.",88,1780);
  return canvas;
}
$("makeRecap").onclick = async () => {
  const canvas = makeRecapCanvas(); const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png")); if (!blob) return;
  const file = new File([blob], "moonledger-recap-" + monthSelect.value + ".png", { type: "image/png" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ title: "My Moonledger recap", files: [file] }); return; } catch (error) { if (error.name === "AbortError") return; } }
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = file.name; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

function syncReminderButton() {
  $("reminderToggle").textContent = reminderEnabled ? "Reminder on" : "Reminder off";
  $("reminderToggle").setAttribute("aria-pressed", String(reminderEnabled));
  if ($("accountReminderToggle")) { $("accountReminderToggle").textContent = reminderEnabled ? "Reminder on" : "Reminder off"; $("accountReminderToggle").setAttribute("aria-pressed", String(reminderEnabled)); }
  $("reminderText").textContent = reminderEnabled ? "A gentle 10 PM check-in. Push reminders need notification permission and Firebase setup; this page-open reminder works now." : "Your 10 PM check-in is paused.";
}
function closeReminder() { $("reminderModal").classList.remove("open"); }
$("reminderToggle").onclick = async () => {
  reminderEnabled = !reminderEnabled; localStorage.setItem(reminderKey, reminderEnabled ? "on" : "off"); syncReminderButton();
  const tokenId = user && localStorage.getItem("moonledger-push-token-" + user.uid);
  if (tokenId) updateDoc(doc(userCollection("notificationTokens"), tokenId), { eveningEnabled: reminderEnabled, updatedAt: new Date().toISOString() }).catch((error) => { $("pushStatus").textContent = "Reminder setting could not sync to push: " + error.message; });
};
$("accountReminderToggle").onclick = () => $("reminderToggle").click();
const reviewPrompts = [
  { text: "Did you order food today?", category: "Food delivery", note: "Food delivery" },
  { text: "Did you buy chai, coffee, or a snack?", category: "Food & drink", note: "Food or drink" },
  { text: "Did you take an auto, cab, or transit ride?", category: "Commute", note: "Commute" },
  { text: "Any groceries or small household buys?", category: "Groceries", note: "Groceries" }
];
function showReviewPrompt() {
  if (reviewIndex >= reviewPrompts.length) { $("reviewPrompt").textContent = "Any other small spends to add today?"; $("reviewDots").textContent = "Review complete"; $("reviewNo").hidden = true; $("reviewYes").hidden = true; return; }
  $("reviewPrompt").textContent = reviewPrompts[reviewIndex].text;
  $("reviewDots").textContent = "Check-in " + (reviewIndex + 1) + " of " + reviewPrompts.length;
}
function nextReview() { reviewIndex++; showReviewPrompt(); }
$("allCaughtUp").onclick = closeReminder;
$("reviewNo").onclick = nextReview;
$("reviewYes").onclick = () => {
  if (reviewIndex >= reviewPrompts.length) return;
  const prompt = reviewPrompts[reviewIndex]; nextReview(); closeReminder();
  openExpenseModal({ amount: "", category: prompt.category, note: prompt.note, method: "UPI", date: new Date().toISOString() });
};
$("addMissed").onclick = () => { closeReminder(); openExpenseModal(); };
let swipeStartX = null;
$("reminderModal").addEventListener("touchstart", (event) => { swipeStartX = event.changedTouches[0].clientX; }, { passive: true });
$("reminderModal").addEventListener("touchend", (event) => { if (swipeStartX !== null && swipeStartX - event.changedTouches[0].clientX > 55) nextReview(); swipeStartX = null; }, { passive: true });
$("enableAlerts").onclick = async () => {
  if (!("Notification" in window)) { $("reminderText").textContent = "The reminder works while Moonledger is open in this browser."; return; }
  const permission = await Notification.requestPermission();
  $("enableAlerts").textContent = permission === "granted" ? "Alerts enabled" : permission === "denied" ? "Alerts blocked" : "Enable alerts";
  if (permission !== "granted") { $("reminderText").textContent = "Notification permission was not granted. The in-page reminder still works while Moonledger is open."; return; }
  if (!user) { $("reminderText").textContent = "Notifications are allowed on this device. Sign in to enable account-synced push reminders."; return; }
  if (!vapidKey) { $("reminderText").textContent = "Permission is ready. Add your Firebase Web Push certificate key and deploy the scheduled reminder function to activate push alerts."; $("pushStatus").textContent = "Waiting for Firebase Web Push key and scheduled function setup."; return; }
  try {
    if (!(await isSupported())) throw new Error("Push messaging is not supported by this browser.");
    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
    if (!token) throw new Error("No push token was created. Check this browser’s notification settings.");
    const tokenKey = "moonledger-push-token-" + user.uid;
    const tokenId = localStorage.getItem(tokenKey) || crypto.randomUUID();
    await setDoc(doc(userCollection("notificationTokens"), tokenId), { token, userId: user.uid, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata", eveningEnabled: reminderEnabled, lastEveningDate: "", updatedAt: new Date().toISOString() });
    localStorage.setItem("moonledger-push-token-" + user.uid, tokenId);
    $("pushStatus").textContent = "Push is enabled on this device. Evening and bill alerts arrive when the scheduled Firebase function is deployed.";
    $("reminderText").textContent = "This device is registered for push. The scheduled Firebase function sends reminders at 10 PM and before due bills.";
  } catch (error) { $("pushStatus").textContent = error.message; $("reminderText").textContent = error.message; }
};
syncReminderButton();
function checkEveningReminder() {
  if (!reminderEnabled || (!user && !guestMode)) return;
  const now = new Date();
  const today = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  if (now.getHours() < 22 || localStorage.getItem(remindedKey) === today) return;
  localStorage.setItem(remindedKey, today); reviewIndex = 0; showReviewPrompt(); $("reviewNo").hidden = false; $("reviewYes").hidden = false; $("reminderModal").classList.add("open");
  if ("Notification" in window && Notification.permission === "granted" && !(user && localStorage.getItem("moonledger-push-token-" + user.uid))) new Notification("Moonledger · evening check-in", { body: "Any little spends to add from today?" });
}
setInterval(checkEveningReminder, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkEveningReminder(); });

$("upiBtn").onclick = () => $("infoModal").classList.add("open");
$("closeInfo").onclick = () => $("infoModal").classList.remove("open");
function setView(view) {
  currentView = view;
  const isOverview = view === "Overview";
  const isExpenses = view === "Expenses";
  const isReports = view === "Monthly reports";
  const isAccount = view === "Your account";
  $("cards").hidden = isExpenses || isAccount;
  $("dailySafeCard").hidden = !isOverview;
  $("budgetCard").hidden = isExpenses || isAccount;
  $("reminderCard").hidden = !isOverview;
  $("reminderCard").hidden = !isOverview || new Date().getHours() < 21;
  $("insightCard").hidden = !isOverview;
  $("reportTools").hidden = !isReports;
  $("expenseSection").hidden = isAccount;
  $("quickCard").hidden = !isOverview;
  $("quickEntryForm").closest(".quick-entry").hidden = isAccount;
  $("quickAdds").hidden = isAccount || $("quickAddList").children.length === 0;
  $("footerNote").hidden = !isOverview;
  $("accountView").hidden = !isAccount;
  $("addBtn").hidden = isAccount;
  $("today").hidden = !isOverview;
  $("greeting").textContent = isOverview ? accountGreeting : view === "Monthly reports" ? "Your month, at a glance." : isAccount ? "Me" : view;
  $("greeting").nextElementSibling.textContent = isOverview ? "A calm little picture of where it went." : isExpenses ? "Every spend, in one place." : isReports ? "Your patterns, without the spreadsheet." : "Private to your signed-in Google account.";
  if (guestMode && isAccount) $("greeting").nextElementSibling.textContent = "Guest entries stay in this browser.";
  if (isOverview && guestMode) $("footerNote").firstChild.textContent = "Guest entries are saved only in this browser. They do not sync until you choose to sign in. ";
  else if (isOverview) $("footerNote").firstChild.textContent = "Your entries are private to your Google account. They sync when you’re online. ";
  $("expenseSection").classList.toggle("expenses-view", isExpenses);
  $("expenseSection").classList.toggle("reports-view", isReports);
  $("expenseSection").querySelector(".section-head h2").textContent = isExpenses ? "All expenses" : isReports ? "Monthly category breakdown" : "Today’s spends";
  $("leaderboardCard").hidden = guestMode || (!isOverview && !isReports);
  $("expenseFilters").hidden = !isExpenses;
  if (isExpenses && $("expenseSearch").value !== expenseSearchText) $("expenseSearch").value = expenseSearchText;
  $("allBtn").hidden = isReports || isAccount;
  showAll = isExpenses;
  $("allBtn").textContent = isExpenses ? "Show recent" : "See all";
  document.querySelectorAll(".nav[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  document.querySelectorAll(".mobile-nav button[data-nav]").forEach((item) => item.classList.toggle("active", item.dataset.nav === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}
setInterval(() => { if (currentView === "Overview") $("reminderCard").hidden = new Date().getHours() < 21; }, 60000);
document.querySelectorAll(".nav[data-view]").forEach((item) => item.addEventListener("click", () => setView(item.dataset.view)));
document.querySelectorAll(".mobile-nav button[data-nav]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.nav)));

const themeToggle = $("themeToggle");
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(themeKey, theme);
  const isDark = theme === "dark";
  themeToggle.textContent = isDark ? "☀" : "☾";
  themeToggle.setAttribute("aria-label", "Switch to " + (isDark ? "light" : "dark") + " mode");
  themeToggle.title = "Switch to " + (isDark ? "light" : "dark") + " mode";
  const themeMeta = document.querySelector('meta[name="theme-color"]'); if (themeMeta) themeMeta.content = isDark ? "#0d0c19" : "#f7f5fc";
}
setTheme(localStorage.getItem(themeKey) || "dark");
themeToggle.onclick = () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

for (let index = 0; index < 6; index++) {
  const date = new Date(); date.setDate(1); date.setMonth(date.getMonth() - index);
  const option = document.createElement("option");
  option.value = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
  option.textContent = date.toLocaleDateString("en-IN", { month: "long", year: "numeric" }); monthSelect.append(option);
}
$("today").textContent = new Date().toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric" });

onAuthStateChanged(auth, (signedInUser) => {
  const hasGoogle = signedInUser && signedInUser.providerData.some((entry) => entry.providerId === "google.com");
  const isVerifiedGmail = signedInUser && signedInUser.emailVerified && /@gmail\.com$/i.test(signedInUser.email || "");
  if (hasGoogle && isVerifiedGmail) showSignedIn(signedInUser);
  else {
    if (!signedInUser && guestMode) return;
    user = null; stopExpenses?.(); stopBudget?.(); stopChallengeListeners(); showSignedOut();
    if (signedInUser) {
      signOut(auth).catch(() => {});
      $("authError").textContent = "Moonledger needs a verified @gmail.com account. Sign in with Gmail to continue.";
    }
  }
});
getRedirectResult(auth).catch((error) => {
  console.error("Google sign-in redirect failed.", error);
  $("authError").textContent = error.message || "Google sign-in could not be completed. Please try again.";
});
window.addEventListener("online", () => { if (user) { $("cloudStatus").textContent = "Back online · syncing your changes."; $("accountCloudStatus").textContent = $("cloudStatus").textContent; } });
window.addEventListener("offline", () => { if (user) { $("cloudStatus").textContent = "Offline mode · changes will sync when you reconnect."; $("accountCloudStatus").textContent = $("cloudStatus").textContent; } });
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("Offline app shell could not be registered.", error));
}
