# QA Plan: Device Matrix & Runtime Test Cases (DRAFT)

> **Status:** v0.1 - 2026-07-24. Tracks runtime verification before pilot launch.

## 1. Device Matrix

| Platform | Device                    | Source               | Status                                                           |
| -------- | ------------------------- | -------------------- | ---------------------------------------------------------------- |
| iOS      | iPhone 17 (simulator)     | Xcode                | ⏳ smoke                                                         |
| iOS      | iPhone 17 Pro (simulator) | Xcode                | ⏳ smoke                                                         |
| iOS      | iPhone Air (simulator)    | Xcode                | ⏳ smoke                                                         |
| iOS      | iPhone SE (small screen)  | Xcode                | ⏳ layout verify                                                 |
| iOS      | Real device (TBD)         | TestFlight           | ⏳ pending device                                                |
| Android  | Pixel (emulator)          | Android Studio       | ⏳ no SDK on this machine - run on a machine with Android Studio |
| Android  | Real device (TBD)         | APK / internal track | ⏳ pending device                                                |

> Android is not available in the current build environment (no `adb`/Android SDK). Android verification must be run on a machine with Android Studio installed.

## 2. Automated Quality Gate (CI)

Covered by `.github/workflows/ci.yml`:

- `tsc --noEmit` (typecheck)
- `eslint .` (lint / static analysis)
- `vitest run` (unit tests, 17 cases)
- `npm audit --omit=dev --audit-level=high` (dependency scan, informational)
- Semgrep SAST (informational)

## 3. Runtime Test Cases (manual or idb-assisted)

### 3.1 Auth & Onboarding (cloud mode)

- [ ] Sign up with email/password; confirm email if confirmation enabled.
- [ ] Sign in.
- [ ] Create household (name, your name, relation); land on Home.
- [ ] Sign out; sign back in; household persists.
- [ ] Invite a caregiver; receive invite member ID / deep link `taskkin-care://invite?member=<id>`.
- [ ] Second user signs up, accepts invite, joins same household, sees members.
- [ ] Expired invite (>48h) is rejected.

### 3.2 Tasks

- [ ] Coordinator creates a task (title, minutes, due, priority, subtasks).
- [ ] Caregiver claims a task; coordinator sees claim notification.
- [ ] Caregiver rejects a task; returns to pool.
- [ ] Caregiver requests handoff to another claim-capable member; target sees notification.
- [ ] Caregiver completes a task with proof; timeline event created; coordinator notified.
- [ ] Pending (not-yet-accepted) members are **not** offered as handoff targets.

### 3.3 Timeline

- [ ] Add timeline event (type, title, starts-at, location).
- [ ] Filter by event type and by member.
- [ ] Viewer can read timeline but not add.

### 3.4 Documents

- [ ] Confirm safety toggle before upload is enforced.
- [ ] Upload a document; on-device OCR extracts candidate fields + confidence (device mode); mock mode shows demo banner.
- [ ] Confirm document candidate; a claimable task is created.
- [ ] Storage upload succeeds (Supabase Storage private bucket).

### 3.5 Notifications & Reports

- [ ] Role-based notifications appear in Home list.
- [ ] Local push fires on new role notification (foreground + background).
- [ ] Push language matches the user's selected UI language.
- [ ] Coordinator generates weekly report; report text snapshot in 3 languages; audit recorded.
- [ ] Critical due alerts cannot be silenced; non-critical digest can be toggled.

### 3.6 Permissions (role differentiation)

- [ ] Coordinator: all tabs + full audit page (Settings -> View all audit).
- [ ] Caregiver: home/tasks/timeline/documents/settings; no audit.
- [ ] Viewer: home/timeline/settings only; tasks/documents/audit hidden.
- [ ] Tab guard falls back to home when active tab becomes inaccessible.

### 3.7 Multi-device sync

- [ ] Device A creates a task; Device B (same household) sees it in real time.
- [ ] Device A completes a task; Device B audit + notification update.

### 3.8 Resilience

- [ ] Offline: app reads cached household state; writes queue / error gracefully.
- [ ] Reconnect: state resyncs from Supabase.

### 3.9 i18n & a11y

- [ ] Switch EN / 中文 / ES; all screens localize; invite member names re-localize per language.
- [ ] Font scaling (Dynamic Type) works; screen-reader labels present.
- [ ] OCR runs on-device in device mode (native build); demo banner only in mock mode (Expo Go dev).

## 4. iOS Simulator Smoke (this environment)

**Result (2026-07-24): ✅ passed**

- iOS bundle compilation: ✅ (Metro `index.bundle?platform=ios`, 873 modules).
- App launch + UI render: ✅ Expo Go installed via GitHub-release mirror (ghproxy.net,断点续传); app renders LocalApp (demo mode) on iPhone 17 simulator.
- Tab navigation: ✅ idb-driven taps verified Home / Tasks / Timeline / Docs / Settings all render.
- OCR: ✅ on-device OCR implemented (@dariyd/react-native-text-recognition, image+PDF+Chinese). In mock mode (Expo Go dev) the demo banner shows; in device mode (native build) real OCR runs. Native-build OCR verification pending prebuild.
- Screenshots: `docs/qa-ios-home.png`, `qa-ios-Tasks.png`, `qa-ios-Timeline.png`, `qa-ios-Docs.png`, `qa-ios-Settings.png`.

Repro (local demo mode, no Supabase needed):

```bash
xcrun simctl boot "iPhone 17" && open -a Simulator
EXPO_PUBLIC_SUPABASE_URL="" EXPO_PUBLIC_SUPABASE_ANON_KEY="" npx expo start --ios --port 8089
# in another shell, with idb (brew install idb-companion; pip3 install fb-idb):
idb screenshot --udid <udid> docs/qa-ios-home.png
idb ui tap --udid <udid> 128 816   # Tasks tab; then screenshot, etc.
```

> Cloud-mode interactive flows (3.1, 3.7) still require a live Supabase project + manual/idb auth taps; local-demo tab navigation and rendering are verified.
