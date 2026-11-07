export const PLAN_NAMES = new Set(["free", "plus", "lifetime", "friend", "owner"]);
export const PLUS_LAUNCHED = false;
export const FREE_LIMITS = Object.freeze({ quickAdds: 5, smartEntriesPerDay: 3, recurringItems: 3, savingsCircles: 1, splitPeople: 2 });

export const PLUS_FEATURES = Object.freeze({
  messageParsing: { label: "SMS and UPI message parsing", available: true },
  sharedScreenshotParsing: { label: "Share payment screenshots from other apps", available: true },
  unlimitedSmartEntry: { label: "Unlimited smart text entry", available: true },
  unlimitedQuickAdds: { label: "Unlimited quick adds", available: true },
  unlimitedBills: { label: "Unlimited recurring bills", available: true },
  subscriptions: { label: "Subscription tracking", available: true },
  moreCircles: { label: "More savings circles", available: true },
  largeSplits: { label: "Splitting with three or more people", available: true },
  iouTracking: { label: "Personal IOU tracking", available: true },
  deeperInsights: { label: "Advanced spending insights", available: true },
  watermarkFreeRecaps: { label: "Watermark-free share cards", available: true },
  statementImport: { label: "Statement import and missed-spend detection", available: false },
  longTermTrends: { label: "Month-to-month trends and yearly summaries", available: false },
  spendingForecast: { label: "Spending forecasts", available: false },
  subscriptionAudit: { label: "Subscription audit", available: false },
  householdTools: { label: "Household tools", available: false },
  multipleBudgets: { label: "Multiple budgets and savings pots", available: false },
  pdfExport: { label: "PDF export", available: false },
  extraThemes: { label: "Extra themes and app icons", available: false },
  cloudBackupHistory: { label: "Cloud backup history", available: false }
});

const PLUS_PLANS = new Set(["plus", "lifetime", "friend", "owner"]);

export function hasPlus(claims = {}, now = Date.now()) {
  if (!PLUS_PLANS.has(claims.plan)) return false;
  if (claims.planUntil == null) return true;
  const until = typeof claims.planUntil === "number"
    ? claims.planUntil
    : typeof claims.planUntil === "string" ? Date.parse(claims.planUntil) : NaN;
  return Number.isFinite(until) && now < until;
}

export function planLabel(claims = {}, now = Date.now()) {
  return hasPlus(claims, now) ? claims.plan : "free";
}
