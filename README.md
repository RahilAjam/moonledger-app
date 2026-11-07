# Moonledger

Moonledger is a mobile-friendly expense tracker. Sign-in uses verified personal Gmail accounts through Google only. Each account's expenses and budgets are stored under its Firebase UID, with Firestore rules denying access to other users' records.

## Open in VS Code

Open this `moonledger-app` folder in VS Code. Install Node.js, then open VS Code's Terminal in this folder and run `npm install` once. Run `npm run dev` to preview the app at the address Vite prints. The Firebase Console's authorized domains must include `localhost` for local Google sign-in.

## Firebase setup

1. Confirm `src/firebase-config.js` matches **Firebase Console → Project settings → Your apps → SDK setup and configuration**. These values are browser configuration, not a service-account secret. Never put a service-account JSON file or private key in this project or GitHub.
2. In **Authentication → Sign-in method**, enable Google and keep other providers disabled. The app and Firestore rules accept verified `@gmail.com` accounts.
3. In **Authentication → Settings → Authorized domains**, add `moonledger-2b6fb.web.app` and `localhost` if they are not already listed.
4. Build and deploy the website and Firestore rules from this folder: `npm run build`, then `firebase deploy --only hosting,firestore:rules`.

Log in with `npx firebase-tools login` the first time. The Hosting and rules command does not deploy the optional scheduled notification function. Each signed-in Google user can access only `users/{their-uid}/...`; circle-shared costs are visible only to that circle. Review the rules before changing them.

## GitHub

Create an empty GitHub repository, then use VS Code's Source Control panel to initialize Git, commit the files, and choose **Publish to GitHub**. Do not add Firebase service account credentials. Hosting can be deployed with the Firebase CLI after each code change; GitHub Actions can be added later if desired.

## Privacy and offline use

Offline persistence is optional and is enabled only when the user checks the trusted-device option at sign-in. Firestore queues offline writes and syncs them when the device reconnects. The app shell is cached for offline opening. Never use persistent offline storage on a shared or public device. Without the checkbox, offline changes are only kept in memory until the page closes.

Guest mode stores expenses and budgets in this browser’s local storage without uploading them. After Google sign-in, users can choose to copy guest entries into their account; account budgets for matching months are preserved. Guest data remains available in the same browser profile, so avoid guest mode on shared devices.

The app does not read UPI notifications. Users enter UPI, cash, and card expenses in the form. The evening reminder runs while the page is open.

## Quick capture

The dashboard accepts short descriptions such as `250 Swiggy dinner` and fills a draft amount, note, payment method, and best-guess category for the user to review before saving. Frequent-spend buttons are generated from that account’s own recent entries. The daily spending guide divides the current month’s remaining budget by the number of days left; it is a planning aid, not a guarantee of affordability.

## Free, Plus, and gifted access

Plan access comes from the Firebase Authentication custom claims `plan` and optional `planUntil`. Missing or expired claims mean Free. `plus`, `lifetime`, `friend`, and `owner` receive Plus access. The browser refreshes the ID token at sign-in, when the page becomes active, and periodically; after an admin change, sign out and back in for an immediate refresh. The app never checks a hard-coded email to grant Plus.

Free includes expense add/edit/delete, categories and payment methods, one monthly budget and daily guide, a basic monthly report, five quick-add buttons, three natural-language entries per day, an evening reminder, dark/light themes, up to three bills, one savings circle, a two-person split, and full CSV export of all expense history.

Plus currently enables pasted SMS/UPI parsing and payment screenshot parsing, unlimited smart entries and quick adds, unlimited bills and subscription entries, additional savings circles, splits with more than two people, personal IOU tracking, deeper current-month insights, and watermark-free recap cards. Plus users can upload a payment screenshot from the Expenses screen, or share one directly from Android when Moonledger is installed as a PWA on a supporting browser. The image is processed on-device with OCR; the first OCR may download the recognition engine and English language data. Moonledger prefills a draft for review and never saves it until the user confirms. OCR can misread amounts, merchants, or dates, so verify them. Features that are not implemented are listed in the account view as planned and remain unavailable even to Plus accounts. There are no payments in this version.

### Grant or revoke a plan

These administrator scripts use `firebase-admin` and the service account JSON only on your computer. Create a service account key in the Firebase/Google Cloud console, store it outside this repository, and never commit or share it. `.gitignore` excludes common key filenames.

```sh
export FIREBASE_SERVICE_ACCOUNT_KEY="/absolute/path/to/private-service-account.json"
npm run plan:grant -- person@gmail.com friend
npm run plan:grant -- person@gmail.com plus 2027-01-31T23:59:59+05:30
npm run plan:revoke -- person@gmail.com
```

Use `plus`, `lifetime`, `friend`, or `owner` for Plus access. An optional expiry is an ISO date/time with its timezone. `revoke` removes the plan claims, and the user becomes Free after refreshing the ID token. The target user must already have signed in once so Firebase Authentication has an account record. Keep the service account key private: it has administrative access to the Firebase project.

For permanent complimentary Plus, run `npm run plan:grant -- person@gmail.com lifetime` with no expiry. This `lifetime` grant stays active until you revoke it with `npm run plan:revoke -- person@gmail.com`.

### Gift one year of Plus to the first 333 users

Prepare a private CSV with one Gmail address per row, ordered by the signup/offer timestamp (the first row is the first eligible user). The first 333 unique addresses are selected; all must already have signed in once. Never commit this list. Set `FIREBASE_SERVICE_ACCOUNT_KEY` as above, then preview the grants:

```sh
npm run plan:grant-first-333 -- --file /absolute/path/promo-emails.csv
```

The preview makes no changes, checks that all selected accounts exist, and skips accounts that already have active Plus/friend, lifetime, or owner access. After reviewing the exact 333 entries and expiry, apply the grants:

```sh
npm run plan:grant-first-333 -- --file /absolute/path/promo-emails.csv --apply
```

The one-year period starts for all recipients at the time the batch runs. Firebase custom claims are changed by this local administrator script, not by a public app screen. For permanent complimentary Plus, use the `lifetime` command above for each selected Gmail account. Recipients need to refresh their sign-in token; signing out and back in is the simplest method.

The previous Firestore Plus Pass/entitlement flow is retired because clients must not grant their own plan. Existing pass-based users need an admin claim grant using the scripts above.

## Archived history

Free users see expenses dated within the rolling 12-month window, using the device’s local calendar date. The exact boundary date remains visible. Older records stay in Firestore or guest storage and are treated as archived; nothing is deleted. Plus, lifetime, friend, and owner accounts see all months. Free users see the archived count and total and can open an informational “Unlock your history” dialog; payment is not implemented. The dialog describes a possible ₹99–149/year option or history access included with Plus.

When the oldest visible month is within 30 days of archiving, the app shows a calm reminder with a one-tap full CSV download. It includes the remaining days (including the 14- and 7-day periods). Email reminders are a TODO. CSV export is free and always includes every expense, including archived entries, for signed-in and guest accounts.

## Checks and deployment

```sh
npm test
npm run test:rules
npm run build
npx firebase-tools deploy --only hosting,firestore:rules
```

The rules test command runs against the Firestore Emulator (a compatible Java runtime is required the first time the emulator is started). It checks per-user expense isolation, rejection of client-written plans, Plus-only larger shared splits, and expired claims. To test manually, sign in with a Free Gmail and confirm a three-person split is blocked by the app and rules; then grant a test account `friend`, sign out/in, and verify that it can create the split and view all history. Revoke it and sign out/in to verify Free access returns. Do not test grants with your production owner account unless you intend to change its access.

This project has no separate lint or TypeScript check configured; `npm test` covers the plan/archive helpers and `npm run build` checks the production bundle. Firestore rules remain the security boundary for account-private and shared data; client gating is for user experience.

## Optional website ads (currently off)

Moonledger includes a public budgeting guide at `/learn.html` and a privacy page at `/privacy.html`. An ad slot is reserved only on the public guide; ad code is not included on the signed-in dashboard or around expense data. Advertising is disabled by default in `public/ads-config.js`, so the site makes no ad-network request while it remains off.

If you later meet Google AdSense requirements and Google approves the site, create an ad unit and enter the publisher ID (`ca-pub-...`) and ad unit slot ID in `public/ads-config.js`, then set `enabled: true`, rebuild, and deploy. Update the privacy and consent experience to match the ad products, audience locations, and current Google requirements before enabling ads. There is no automatic unlock at 1,000 users; approval depends on the site, account, and policy review, and earnings are not guaranteed.

## Older prototype entries

The earlier prototype stores records in browser-only storage. In that prototype, click **Download a backup** at the bottom of the page. In this app, sign in to the intended Gmail account and choose **Import an older backup** at the bottom. The app previews the counts and asks before uploading records to that account.
