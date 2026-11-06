import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence, getAuth, GoogleAuthProvider, onAuthStateChanged,
  setPersistence, signInWithPopup, signInWithRedirect, signOut
} from "firebase/auth";
import {
  addDoc, collection, doc, getFirestore, initializeFirestore,
  onSnapshot, orderBy, persistentLocalCache, persistentMultipleTabManager, query,
  setDoc, writeBatch
} from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });
const $ = (id) => document.getElementById(id);
const themeKey = "moonledger-theme-v1";
const reminderKey = "moonledger-reminder-v1";
const remindedKey = "moonledger-last-reminder-v1";
const gate = $("authGate");
const shell = $("appShell");
const mobileNav = document.querySelector(".mobile-nav");
const monthSelect = $("monthSelect");
let db;
let user = null;
let expenses = [];
let budgets = {};
let method = "UPI";
let showAll = false;
let currentView = "Overview";
let accountGreeting = "Your money, in view.";
let stopExpenses;
let stopBudget;
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

function showSignedOut() {
  gate.hidden = false;
  shell.hidden = true;
  mobileNav.hidden = true;
  $("signOutBtn").hidden = true;
}

function showSignedIn(signedInUser) {
  user = signedInUser;
  gate.hidden = true;
  shell.hidden = false;
  mobileNav.hidden = false;
  $("signOutBtn").hidden = false;
  const name = (user.displayName || user.email?.split("@")[0] || "You").trim();
  $("accountEmail").textContent = user.email || "Google account";
  $("accountEmail").title = user.email || "Google account";
  accountGreeting = "Your money, " + name + ".";
  $("greeting").textContent = accountGreeting;
  $("accountName").textContent = name + "’s Moonledger account";
  $("accountEmailDetail").textContent = user.email || "Google account";
  $("accountAvatar").textContent = name.charAt(0).toUpperCase();
  $("sideName").textContent = name + "’s space";
  $("avatar").textContent = name.charAt(0).toUpperCase();
  startSync();
  setView(currentView);
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
$("signOutBtn").addEventListener("click", async () => {
  stopExpenses?.();
  stopBudget?.();
  await signOut(auth);
  showSignedOut();
});

function startSync() {
  if (!user) return;
  stopExpenses?.();
  stopBudget?.();
  const expensesQuery = query(userCollection("expenses"), orderBy("date", "desc"));
  stopExpenses = onSnapshot(expensesQuery, (snapshot) => {
    expenses = snapshot.docs.map((entry) => Object.assign({ id: entry.id }, entry.data()));
    render();
    $("cloudStatus").textContent = !navigator.onLine || snapshot.metadata.fromCache
      ? "Offline mode · changes will sync when you reconnect."
      : "Synced to your private account.";
    $("accountCloudStatus").textContent = $("cloudStatus").textContent;
  }, (error) => { $("cloudStatus").textContent = "Couldn’t load expenses: " + error.message; $("accountCloudStatus").textContent = $("cloudStatus").textContent; });
  watchBudget(monthSelect.value);
}

function watchBudget(month) {
  stopBudget?.();
  budgets = {};
  if (!user || !month) return;
  stopBudget = onSnapshot(doc(userCollection("budgets"), month), (snapshot) => {
    budgets[month] = snapshot.exists() ? Number(snapshot.data().amount || 0) : 0;
    updateBudget();
  }, (error) => { $("cloudStatus").textContent = "Couldn’t load budget: " + error.message; });
}

const icons = { "Food & drink": "☕", Travel: "↗", Shopping: "◇", Bills: "⌂", Health: "✚", Home: "⌂", Entertainment: "♫", Other: "·" };
const money = (amount) => "₹" + Number(amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function renderContent() {
  if (!monthSelect.value) return;
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
  const sorted = monthItems.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const list = $("expenseList");
  list.replaceChildren();
  if (!sorted.length) list.innerHTML = '<div class="empty">Nothing here yet. Add your first expense to get started.</div>';
  sorted.slice(0, showAll ? 40 : 4).forEach((entry) => {
    const row = document.createElement("div");
    row.className = "expense";
    row.innerHTML = '<div class="eicon">' + (icons[entry.category] || "·") + '</div><div class="edesc"><strong>' + escapeHtml(entry.note || entry.category) + '</strong><small>' + new Date(entry.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + " · " + escapeHtml(entry.method) + " · " + escapeHtml(entry.category) + '</small></div><div class="eamount">−' + money(entry.amount) + '</div>';
    list.append(row);
  });
  const totals = {};
  monthItems.forEach((entry) => { totals[entry.category] = (totals[entry.category] || 0) + Number(entry.amount); });
  const categories = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 4);
  $("categories").innerHTML = categories.length
    ? categories.map(([name, amount]) => '<div class="category"><div class="cat-head"><span>' + escapeHtml(name) + '</span><small>' + money(amount) + '</small></div><div class="bar"><i style="width:' + Math.max(4, Math.round(amount / total * 100)) + '%"></i></div></div>').join("")
    : '<div class="empty">Your category breakdown will show up here.</div>';
}

function render() { renderContent(); updateBudget(); }
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
  if (!budget) {
    $("budgetEmpty").hidden = false; $("budgetProgress").hidden = true; $("setBudget").hidden = false; $("budgetNumbers").textContent = ""; return;
  }
  $("budgetEmpty").hidden = true; $("budgetProgress").hidden = false; $("setBudget").hidden = true;
  $("budgetNumbers").textContent = money(spent) + " / " + money(budget);
  const ratio = spent / budget;
  $("budgetFill").style.width = Math.min(100, Math.max(0, ratio * 100)) + "%";
  $("budgetFill").className = "budget-fill" + (ratio >= 1 ? " over" : ratio >= 0.8 ? " warn" : "");
  $("budgetStatus").textContent = ratio >= 1 ? "Over budget by " + money(spent - budget) : money(budget - spent) + " left · " + Math.round(ratio * 100) + "% used";
  $("budgetStatus").style.color = ratio >= 1 ? "#b86678" : "";
}

function openExpenseModal() { $("modal").classList.add("open"); setTimeout(() => $("amount").focus(), 30); }
function closeExpenseModal() { $("modal").classList.remove("open"); }
$("addBtn").onclick = openExpenseModal;
$("cancelBtn").onclick = closeExpenseModal;
$("allBtn").onclick = () => { showAll = !showAll; $("allBtn").textContent = showAll ? "Show less" : currentView === "Expenses" ? "Show all" : "See all"; render(); };
monthSelect.onchange = () => { watchBudget(monthSelect.value); render(); };
document.querySelectorAll("[data-method]").forEach((button) => button.onclick = () => {
  method = button.dataset.method;
  document.querySelectorAll("[data-method]").forEach((choice) => choice.classList.toggle("selected", choice === button));
});

$("expenseForm").onsubmit = async (event) => {
  event.preventDefault();
  if (!user) return;
  const amount = Number($("amount").value);
  if (!amount || amount <= 0) return;
  try {
    const save = addDoc(userCollection("expenses"), {
      amount, method, category: $("category").value, note: $("note").value.trim(), date: new Date().toISOString()
    });
    event.target.reset(); method = "UPI";
    document.querySelectorAll("[data-method]").forEach((choice) => choice.classList.toggle("selected", choice.dataset.method === "UPI"));
    closeExpenseModal();
    save.catch((error) => alert("This expense could not sync to your account. It remains on this device for now. " + error.message));
  } catch (error) { alert("This expense could not be saved. Check your connection and try again. " + error.message); }
};

function openBudgetModal() {
  const parts = monthSelect.value.split("-").map(Number);
  $("budgetModalMonth").textContent = "Set a target for " + new Date(parts[0], parts[1] - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }) + ".";
  $("budgetAmount").value = budgets[monthSelect.value] || "";
  $("budgetModal").classList.add("open"); setTimeout(() => $("budgetAmount").focus(), 30);
}
function closeBudgetModal() { $("budgetModal").classList.remove("open"); }
$("setBudget").onclick = openBudgetModal; $("editBudget").onclick = openBudgetModal; $("cancelBudget").onclick = closeBudgetModal;
$("budgetForm").onsubmit = async (event) => {
  event.preventDefault();
  const amount = Number($("budgetAmount").value);
  if (!amount || amount <= 0 || !user) return;
  try {
    const save = setDoc(doc(userCollection("budgets"), monthSelect.value), { amount, updatedAt: new Date().toISOString() });
    closeBudgetModal();
    save.catch((error) => alert("This budget could not sync to your account. " + error.message));
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
    const validCategories = ["Food & drink", "Travel", "Shopping", "Bills", "Health", "Home", "Entertainment", "Other"];
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

function syncReminderButton() {
  $("reminderToggle").textContent = reminderEnabled ? "Reminder on" : "Reminder off";
  $("reminderToggle").setAttribute("aria-pressed", String(reminderEnabled));
  if ($("accountReminderToggle")) { $("accountReminderToggle").textContent = reminderEnabled ? "Reminder on" : "Reminder off"; $("accountReminderToggle").setAttribute("aria-pressed", String(reminderEnabled)); }
  $("reminderText").textContent = reminderEnabled ? "A gentle nudge to add anything you forgot today. Works while this page is open." : "Your 10 PM check-in is paused.";
}
function closeReminder() { $("reminderModal").classList.remove("open"); }
$("reminderToggle").onclick = () => { reminderEnabled = !reminderEnabled; localStorage.setItem(reminderKey, reminderEnabled ? "on" : "off"); syncReminderButton(); };
$("accountReminderToggle").onclick = () => $("reminderToggle").click();
$("allCaughtUp").onclick = closeReminder;
$("addMissed").onclick = () => { closeReminder(); openExpenseModal(); };
$("enableAlerts").onclick = async () => {
  if (!("Notification" in window)) { $("reminderText").textContent = "The reminder works while Moonledger is open in this browser."; return; }
  const permission = await Notification.requestPermission();
  $("enableAlerts").textContent = permission === "granted" ? "Alerts enabled" : permission === "denied" ? "Alerts blocked" : "Enable alerts";
  $("reminderText").textContent = permission === "granted" ? "Browser alerts are enabled while Moonledger is open." : "The in-page 10 PM reminder is still on.";
};
syncReminderButton();
function checkEveningReminder() {
  if (!reminderEnabled || !user) return;
  const now = new Date();
  const today = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  if (now.getHours() < 22 || localStorage.getItem(remindedKey) === today) return;
  localStorage.setItem(remindedKey, today); $("reminderModal").classList.add("open");
  if ("Notification" in window && Notification.permission === "granted") new Notification("Moonledger · evening check-in", { body: "Any little spends to add from today?" });
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
  $("budgetCard").hidden = isExpenses || isAccount;
  $("reminderCard").hidden = !isOverview;
  $("expenseSection").hidden = isAccount;
  $("quickCard").hidden = !isOverview;
  $("footerNote").hidden = !isOverview;
  $("accountView").hidden = !isAccount;
  $("addBtn").hidden = isAccount;
  $("today").hidden = !isOverview;
  $("greeting").textContent = isOverview ? accountGreeting : view;
  $("greeting").nextElementSibling.textContent = isOverview ? "A calm little picture of where it went." : isExpenses ? "Every spend, in one place." : isReports ? "A clear picture of this month’s spending." : "Private to your signed-in Google account.";
  $("expenseSection").classList.toggle("expenses-view", isExpenses);
  $("expenseSection").classList.toggle("reports-view", isReports);
  $("expenseSection").querySelector(".section-head h2").textContent = isExpenses ? "All expenses" : isReports ? "Monthly category breakdown" : "Recent expenses";
  $("allBtn").hidden = isReports || isAccount;
  showAll = isExpenses;
  $("allBtn").textContent = isExpenses ? "Show recent" : "See all";
  document.querySelectorAll(".nav[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  document.querySelectorAll(".mobile-nav button[data-nav]").forEach((item) => item.classList.toggle("active", item.dataset.nav === view));
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}
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
}
setTheme(localStorage.getItem(themeKey) || "light");
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
    user = null; stopExpenses?.(); stopBudget?.(); showSignedOut();
    if (signedInUser) {
      signOut(auth).catch(() => {});
      $("authError").textContent = "Moonledger needs a verified @gmail.com account. Sign in with Gmail to continue.";
    }
  }
});
window.addEventListener("online", () => { if (user) { $("cloudStatus").textContent = "Back online · syncing your changes."; $("accountCloudStatus").textContent = $("cloudStatus").textContent; } });
window.addEventListener("offline", () => { if (user) { $("cloudStatus").textContent = "Offline mode · changes will sync when you reconnect."; $("accountCloudStatus").textContent = $("cloudStatus").textContent; } });
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("Offline app shell could not be registered.", error));
}
