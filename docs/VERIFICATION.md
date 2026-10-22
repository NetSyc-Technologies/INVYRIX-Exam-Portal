# INVYRIX implementation verification

Verified locally on 22 October 2026.

- Nine unit tests pass for dashboard calculations, subscription boundaries, slug validation, answer-key redaction and grading.
- Firestore Rules were updated for Spark client writes and tenant isolation; the local emulator check is currently blocked by the Java/emulator port timeout noted below.
- The Spark frontend-only adapter is covered by main and mobile TypeScript checks and production builds. Cloud Functions are not part of the deployed Firebase configuration.
- Main and mobile TypeScript checks and production builds pass. Vite reports large Firebase/PDF-related chunks; route screens are lazy-loaded.
- Local landing and registration pages were inspected at localhost:5173. The landing screenshot is `invyrix-preview.png`.
- The Windows x64 NSIS installer built successfully. Its executable has a valid MZ header; the application archive contains only config.json, logo.png, main.cjs, offline.html, package.json and preload.cjs. No .env or server credential is packaged.
- Web production dependency checks pass; the deployed Spark build does not include Cloud Functions or Storage packages.

## Remaining operational work

The currently authenticated Firebase CLI account does not have access to invyrix-exam-portal. No cloud deployment, DNS changes, live account approvals or data migration were performed. Follow the root README using an authorized project account. Enable Google/Anonymous Authentication, deploy Firestore rules/indexes and Hosting, and provision the custom HTTPS domain before distributing the connected desktop app.

The installer is unsigned and has not been installed for an interactive exam test. No code-signing certificate was supplied. Live Google sign-in, institute logo uploads, and complete camera/mobile exams still need acceptance testing against the configured production project and intended devices.

The full development-tool audit still reports 24 advisories (16 moderate, 7 high, 1 critical) in Firebase CLI/packaging dependency chains; these packages are not included in the web bundle or the minimal desktop app. The latest Firebase CLI requires Java 21 for emulator operation; this computer currently has Java 17. Upgrade the development JDK and CLI, review remaining packaging dependencies, and rerun emulator/installer verification before treating the build environment as fully patched. Production dependency audits are clean; this is not a claim that the entire system is free of defects.

Approval and renewal notifications are dashboard-based. Email delivery and online billing are not configured. Existing proctoring uses browser/device signals and does not provide operating-system lockdown or guaranteed misconduct detection.

The old hardcoded-password bulk-reset control was removed because it could partially delete institute data under the new membership rules. Individual authorized exam/session deletion remains available. No existing production records were deleted or changed.

Installer: release/INVYRIX-Setup-2.0.0.exe

SHA-256: ADC4051F0C3F91A85603035C8E95F68F77F27D95F17671468A7C3F135D5B5C2A
