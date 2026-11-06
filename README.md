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

## Free and Plus plans

Free includes expense tracking (add/edit/delete), categories, payment methods, dates and notes, one monthly budget with the daily guide, the basic monthly category report, up to five quick-add buttons, the evening reminder, both themes, guest mode, Google sync, up to three recurring bills/subscriptions, one savings circle, and a two-person split.

Plus is currently an invite-only entitlement; Moonledger does not collect payments or start subscriptions. Existing expense records remain available. The app gates natural-language entry, pasted-message parsing, extra recurring items/circles, larger splits and personal IOU tracking, weekday insight charts, CSV export, and recap sharing behind Plus. Some broader roadmap ideas such as PDF export, statement import, multiple budgets, and subscription audits are not implemented yet and are not represented as working features.

### Issue a private Plus Pass

Each pass is a one-time, permanent unlock tied to one exact Gmail address. Create it yourself in **Firebase Console → Firestore Database → Data**; never put real pass codes in GitHub, app source, screenshots, or a public message.

1. Generate a random 32-character uppercase hexadecimal ID on your own computer (for example, in a private terminal run `node -e "console.log(require('node:crypto').randomBytes(16).toString('hex').toUpperCase())"`). Keep the output private and send it only to the intended person.
2. In Firestore, create a top-level collection named `accessCodes`, and a document whose ID is that code.
3. Add fields: `active` (boolean `true`), `recipientEmail` (string with the recipient’s Gmail address exactly as shown in their Moonledger account), and optionally `note` (string, for your private label). Do not add `claimedBy` or `claimedAt`.
4. Deploy the current Firestore rules. The rules prevent app users from listing or reading codes, creating codes, or claiming another person’s pass. Redeeming writes the claim and the user’s Plus entitlement atomically.
5. The recipient signs in to Moonledger with that Gmail, opens **Me → Plus Pass**, enters the code, and selects **Unlock Plus**. A pass cannot be reused, and only the matching account can claim it.

For your own account, create a pass addressed to your Gmail the same way. If a code is lost before redemption, delete the unused code in the Firebase Console and issue a new random one. After redemption, the entitlement remains on that account; deleting its claimed code does not revoke it.

## Optional website ads (currently off)

Moonledger includes a public budgeting guide at `/learn.html` and a privacy page at `/privacy.html`. An ad slot is reserved only on the public guide; ad code is not included on the signed-in dashboard or around expense data. Advertising is disabled by default in `public/ads-config.js`, so the site makes no ad-network request while it remains off.

If you later meet Google AdSense requirements and Google approves the site, create an ad unit and enter the publisher ID (`ca-pub-...`) and ad unit slot ID in `public/ads-config.js`, then set `enabled: true`, rebuild, and deploy. Update the privacy and consent experience to match the ad products, audience locations, and current Google requirements before enabling ads. There is no automatic unlock at 1,000 users; approval depends on the site, account, and policy review, and earnings are not guaranteed.

## Older prototype entries

The earlier prototype stores records in browser-only storage. In that prototype, click **Download a backup** at the bottom of the page. In this app, sign in to the intended Gmail account and choose **Import an older backup** at the bottom. The app previews the counts and asks before uploading records to that account.
