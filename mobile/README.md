# Fortuna mobile

Expo SDK 57 / React Native app for iOS and Android, backed by the same Next.js server actions as Fortuna web.

## Run on your phone

Use Node 22.13 or newer (`nvm use` reads `.nvmrc`). Run package commands inside `mobile/`, not the repository root.

```sh
cd /Users/johansoo/Projects/fortuna
docker compose -f docker-compose.dev.yml up -d
cd mobile
nvm use
npm ci
npm run start:lan
```

Scan the QR code with an Expo Go version supporting SDK 57. The phone and computer must be on the same network. At sign-in, enter the **web app** domain or URL reachable from the phone, for example `https://fortuna.delishad.com`. Bare domains automatically use HTTPS. For local development, use the computer's LAN address and the `APP_PORT` configured for your Docker stack. `localhost` on a physical phone refers to the phone itself.

To prefill the server address, copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_API_URL`. This public variable must never contain credentials. Local HTTP is accepted only in development; production requires HTTPS. Sign in with your existing Fortuna account or register in the app.

```sh
npm run ios                 # Expo Go in an installed iOS simulator
npm run android             # Expo Go in an installed Android emulator
npm run start:dev-client    # An installed custom development build
```

The optional Expo web preview needs a same-origin API proxy when the backend is on another port; the end-to-end test provides it. Next.js remains the web product.

## Expo Go development loop

Set `EXPO_PUBLIC_API_URL` in `.env.local` to the HTTPS domain of the Fortuna server, then run `npm run start:lan` from `mobile/`. With the phone on the same LAN, open Expo Go and scan the displayed QR code. Source edits update the running app without compiling another APK. The server field remains editable on the sign-in screen, and the selected host is stored with the mobile session.

## Features and interactions

- Home: month selection, cash flow, spending trend, recent activity and review queues.
- Activity: paginated transactions; search/date/amount/type/category/account filters; full-screen editing; splits; reimbursements; internal transfers; selected-row bulk updates/deletion and CSV sharing.
- Imports: staged MCP statements first, with review counts and saved history; searchable Needs review/Labelling/Reconciliation/Ready filters, proposal decisions, account/category edits, internal transfers and reimbursement allocation, plus a fixed save action. Native file selection supports multiple statements, Revolut supplemental files and duplicate review.
- Trips: details and covers, wallets, manual entries, statements, bank-ledger selection, funding creation/editing/matching/merging, transfers from other trips, FX recalculation and propagation summaries.
- Analytics: report periods, custom dates, measures, category/merchant grouping, insights, all-time overview and CSV sharing.
- Settings: profile, password, persistent light/dark/system theme, categories, accounts, import rules, learned patterns, auto-label confidence, analytics exclusions, PayLah preference and API token/session management.

MCP drafts are stored on the server and appear on both web and mobile. Newly uploaded statement reviews remain in memory and clear when the app closes or signs out. Saved records live on the server. This version requires connectivity and does not queue offline writes. The backend remains authoritative for validation, reimbursement accounting and FX calculations.

## Backend and security

Deploy both frontend and data-service changes alongside the app. The staged review counts and row flags are returned by the data-service; web and mobile read the same drafts. Endpoints: `/api/mobile/session`, `/api/mobile/action`, `/api/mobile/parse`. The existing `ApiToken` migration must be applied; the dev stack runs data-service migrations.

Sessions use random tokens hashed at rest on the server, expire after 30 days, and have a dedicated `mobile:session` scope. Native credentials use Expo SecureStore. Sign-out revokes server access. Settings can revoke other device sessions. The operation route has an explicit allowlist, rejects supplied ownership fields and establishes request-local authentication before invoking existing actions. Internal service credentials never reach the phone.

Login throttling is process-local; multi-replica deployments should enforce shared throttling at ingress. Keep the data-service and parser on the private backend network.

## Branding

`../branding/fortuna.png` is the exact supplied image. Run `npm run brand:sync` here to copy it to both apps. Web uses a CSS crop for small brand marks; launcher icons, splash, favicon and Apple icon use the supplied image. No AI recreation is involved.

## Validation

```sh
npm run typecheck
npx expo-doctor
npm run export
npx playwright install chromium
npm run web -- --port 8081
# Another terminal, with Docker running:
npm run test:e2e
```

The integration test creates a temporary account, exercises the real backend and phone-sized UI, then deletes its account in `finally`. Defaults: web port 3001 and Postgres 5433. Override `FORTUNA_TEST_SERVER` and `FORTUNA_TEST_DATABASE_URL` for another development stack. Screenshots go to ignored `test-results/`.

Run `npm test` and `npm run build` in `../frontend` too. New tests cover ownership rejection, date decoding and trip reimbursement index remapping.

Validated: TypeScript, Expo configuration, frontend build/tests, iOS/Android JavaScript exports and browser integration at 390 × 844. Physical-device file pickers, share sheets, keyboards and native distributions still need device QA. JS export is not a signed native build.

## Native distributions

`eas.json` supplies development, preview and production profiles. Configure your Expo project, signing credentials, final bundle identifiers and HTTPS API URL before running:

```sh
npx eas-cli build --platform ios --profile preview
npx eas-cli build --platform android --profile preview
```

No EAS build, store submission or public release has been performed.

## Repository rename

The real folder is `/Users/johansoo/Projects/fortuna`. A compatibility symlink at the old path keeps already-open tooling working. Docker bind mounts have been refreshed. Both Compose files retain the existing `personal-finance-app` project identity to preserve named volumes and avoid creating a second stack.

## Downloadable Android test APK

The `Build Android test APK` GitHub Actions workflow is manual-only so Expo Go iterations do not create unnecessary APKs. Start it from the Actions tab when a tested mobile version is ready to package. Open a successful run, download the `Fortuna-Android-test-*` artifact, unzip it, and install the APK on Android. Android may ask you to allow installs from your browser or file manager. This test APK uses debug signing and is intended for direct device testing, not Play Store release.
