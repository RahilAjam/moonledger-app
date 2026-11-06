# Moonledger

Moonledger is a mobile-friendly expense tracker. Sign-in uses verified personal Gmail accounts through Google only. Each account's expenses and budgets are stored under its Firebase UID, with Firestore rules denying access to other users' records.

## Open in VS Code

Open this `moonledger-app` folder in VS Code. Install Node.js, then open VS Code's Terminal in this folder and run `npm install` once. Run `npm run dev` to preview the app at the address Vite prints. The Firebase Console's authorized domains must include `localhost` for local Google sign-in.

## Firebase setup

1. Confirm `src/firebase-config.js` matches **Firebase Console → Project settings → Your apps → SDK setup and configuration**. These values are browser configuration, not a service-account secret. Never put a service-account JSON file or private key in this project or GitHub.
2. In **Authentication → Sign-in method**, enable Google and keep other providers disabled. The app and Firestore rules accept verified `@gmail.com` accounts.
3. In **Authentication → Settings → Authorized domains**, add `moonledger-2b6fb.web.app` and `localhost` if they are not already listed.
4. Build and deploy with the Firebase CLI from this folder: `npm run build`, `firebase deploy`.

To publish, run `npm run build`, then `npx firebase-tools login` the first time and `npx firebase-tools deploy`. This publishes the built site and the Firestore rules in this folder. Each signed-in Google user can access only `users/{their-uid}/...`. Review the rules before changing them.

## GitHub

Create an empty GitHub repository, then use VS Code's Source Control panel to initialize Git, commit the files, and choose **Publish to GitHub**. Do not add Firebase service account credentials. Hosting can be deployed with the Firebase CLI after each code change; GitHub Actions can be added later if desired.

## Privacy and offline use

Offline persistence is optional and is enabled only when the user checks the trusted-device option at sign-in. Firestore queues offline writes and syncs them when the device reconnects. The app shell is cached for offline opening. Never use persistent offline storage on a shared or public device. Without the checkbox, offline changes are only kept in memory until the page closes.

The app does not read UPI notifications. Users enter UPI, cash, and card expenses in the form. The evening reminder runs while the page is open.

## Quick capture

The dashboard accepts short descriptions such as `250 Swiggy dinner` and fills a draft amount, note, payment method, and best-guess category for the user to review before saving. Frequent-spend buttons are generated from that account’s own recent entries. The daily spending guide divides the current month’s remaining budget by the number of days left; it is a planning aid, not a guarantee of affordability.

## Optional website ads (currently off)

Moonledger includes a public budgeting guide at `/learn.html` and a privacy page at `/privacy.html`. An ad slot is reserved only on the public guide; ad code is not included on the signed-in dashboard or around expense data. Advertising is disabled by default in `public/ads-config.js`, so the site makes no ad-network request while it remains off.

If you later meet Google AdSense requirements and Google approves the site, create an ad unit and enter the publisher ID (`ca-pub-...`) and ad unit slot ID in `public/ads-config.js`, then set `enabled: true`, rebuild, and deploy. Update the privacy and consent experience to match the ad products, audience locations, and current Google requirements before enabling ads. There is no automatic unlock at 1,000 users; approval depends on the site, account, and policy review, and earnings are not guaranteed.

## Older prototype entries

The earlier prototype stores records in browser-only storage. In that prototype, click **Download a backup** at the bottom of the page. In this app, sign in to the intended Gmail account and choose **Import an older backup** at the bottom. The app previews the counts and asks before uploading records to that account.
