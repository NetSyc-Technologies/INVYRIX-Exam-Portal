# INVYRIX by NetSyc Technologies

Multi-institute examination portal with a Windows desktop client. Each approved institute has a permanent URL slug and INVYRIX ID, its own staff, exams, sessions, logo and subscription. Existing exam creation, monitoring, reports and mobile companion screens are retained within institute routes.

## Local setup

Use Node.js 22.14+ and Java 17+ for local Firebase emulators. Run from this directory:

```sh
npm ci
npm run dev
```

The root `.env` contains the supplied `invyrix-exam-portal` web configuration. `.env.example` lists supported settings. Both web and mobile read the root environment; restart Vite after changes. `VITE_*` values are browser-visible Firebase configuration, not server secrets. Never place private keys or passwords in a `VITE_*` variable.

| Route | Purpose |
| --- | --- |
| `/` | Global landing page and institute lookup |
| `/register` | Verified Google sign-in, institute/admin details and versioned terms consent |
| `/admin` | Account dashboard, application status and institute links |
| `/superadmin` | Approval, manual creation, subscription dates, pause messages, renewal and name editing |
| `/download` | Windows installer |
| `/desktop` | First-run INVYRIX ID entry |
| `/{slug}` | Institute-branded student portal |
| `/{slug}/admin` | Institute staff sign-in |
| `/{slug}/admin/dashboard/subscription` | Branding and renewal requests, available after expiry |
| `/mobile/?institute={slug}&code={code}` | Paired mobile companion |

The super admin is the verified Google identity `admin@netsyc.com`. No client-side seeding or password is required. Institute administrators use the Google account nominated in their registration. Faculty membership is granted by that institute's administrator.

## Approval and subscriptions

The super admin reviews registration and chooses a unique slug and future expiry. Approval assigns an `INV-…` ID and exposes the link in the applicant's dashboard. Slugs and IDs stay stable when the super admin changes the institute's display name. Institute admins can upload PNG/JPEG/WebP logos under 2 MB but cannot edit their name, expiry or role.

Expired or paused portals deny exam access in the UI and Firestore Rules. A custom pause message is displayed. Staff can still sign in to request renewal; only super-admin renewal restores access. Renewal requests are manually reviewed; no payment provider or outbound email service is configured. Decisions and links appear in the account dashboard.

## Free Spark mode

The current build is intentionally frontend-only and compatible with Firebase's free Spark plan. It uses Firebase Authentication and Firestore client operations only; Cloud Functions, Cloud Storage and other paid Firebase services are not required. Registration, approvals, subscriptions, sessions, mobile pairing and grading are authorized by Firestore Rules.

Exam answer values are removed before an exam is written. Each answer is stored as a SHA-256 `answerKeyHash`, and passwords are stored as `examPasswordHash`. The browser compares hashes when grading. Hashing prevents the original values from being stored, but frontend-only code cannot provide server-grade secrecy: a determined participant can inspect the browser and database rules. Use this mode for low-stakes or pilot examinations.

## Firebase deployment

The local build is not a deployment. Authenticate the Firebase CLI with an account that has access to **invyrix-exam-portal**:

```sh
npx firebase login --reauth
npx firebase projects:list
```

In that project's Firebase console:

1. Enable Google and Anonymous Authentication. Add `localhost` and `invyrix.netsyc.com` to authorized domains. Ensure `admin@netsyc.com` can use Google sign-in with that verified address.
2. Create Firestore and enable Google and Anonymous Authentication. No Functions or Storage setup is required for this mode.
3. Build and deploy the database rules/indexes and hosting:

```sh
npm run desktop:build
npm run build
npx firebase deploy --project invyrix-exam-portal --only firestore,hosting
```

Connect `invyrix.netsyc.com` as a Firebase Hosting custom domain and add the DNS records Firebase supplies. Wait for HTTPS provisioning. Hosting rewrites preserve institute deep links and serve the mobile bundle at `/mobile/`. The desktop client points to this HTTPS production origin, so it needs the deployed site to be usable.

The included terms page is operational product text; finalize NetSyc's commercial, privacy and retention terms before public registration.

## Windows application

```sh
npm run desktop:build
```

Output: `release/INVYRIX-Setup-2.0.0.exe` (Windows x64 NSIS installer), also copied to `dist/downloads/`. Rebuilding the website includes it in Hosting's download directory.

The app validates the first-entered INVYRIX ID against Firebase and remembers the institute in the Windows user's app-data directory. Future launches open that institute. Branding and subscription status are read live. The menu can deliberately unlink the institute. Staff administration opens in the system browser. The renderer is sandboxed, has no Node access, and has only a narrow first-run linking bridge. The package excludes `.env`, web dependencies and server credentials.

The installer is unsigned because no code-signing certificate was supplied. It is an online exam client, not an offline exam engine or an operating-system lockdown product. Camera/focus/fullscreen checks provide monitoring signals and remain subject to browser/device limitations. Run an acceptance exam on intended lab hardware before rollout.

## Verification

```sh
npm test
npm run typecheck
npm run test:rules
npm run test:integration
npm run build
```

Emulator scripts use only `demo-invyrix`. Tests cover tenant boundaries, roles, expiry, pause/renewal, registration approval, duplicate attempts, private answer keys, server grading, answer validation and result visibility. The integration wrapper allows additional function discovery time on Windows.

For manual emulator development, set `VITE_USE_EMULATORS=true`, restart Vite, then run `npx firebase emulators:start --project demo-invyrix`. Restore `false` before production builds. `npm run dev:mobile` serves the companion on port 5174; use its institute query parameters. Mobile and desktop builds share the root dependency installation.

## Data isolation and existing data

Institute data lives under `institutes/{slug}`. Private contacts, applications, audits, grades, answer keys and membership directories have separate access controls. Students use an anonymous Firebase identity; result lookup is restricted to sessions owned by the same browser profile. Clearing that profile removes access to its anonymous identity; institute staff can still retrieve records.

Answer hashes, roster checks, attempt limits, start times and grading are performed by the frontend and constrained by Firestore Rules. Scores stay in grade records and are returned to a session owner only while publication is enabled. Client code and telemetry can be inspected or modified by a determined participant, so this free mode is not suitable for high-stakes exams without a trusted backend.

No old project data is moved or deleted automatically. A copy-only migration helper supports explicit source and target projects. First approve the destination institute, configure administrative credentials for both projects, back up the source, and run a dry run:

```sh
node scripts/migrate-legacy.mjs --source-project OLD_PROJECT_ID --target-project invyrix-exam-portal --institute APPROVED_SLUG
```

Review output before repeating with `--apply`. The script refuses active legacy sessions, skips existing destination records and preserves source data. Historical student sessions without owner identities remain staff-accessible rather than publicly searchable. Retain source backups and verify counts/reports after migration.
