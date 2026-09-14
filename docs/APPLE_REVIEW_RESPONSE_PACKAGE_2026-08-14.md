# TaskKin Care - Apple App Review Response Package

Prepared: 2026-08-14  
Project: `/Users/jun/Documents/Project/relaycare-mvp`  
App: TaskKin Care  
Bundle ID: `cd.cc.relaycare`  
Source version: `1.0.0`  
Current local build number: `2` (set in `app.json`; verify the archive carries build `2` and that it is unused in App Store Connect).

## 1. Release decision

The reply text and supporting materials are prepared, but the submission is **not ready to send yet**. Complete every item below first:

- [ ] Install the exact TestFlight/App Store candidate on a physical iPhone running iOS 26.6, which Apple lists as the latest iOS release as of 2026-08-14: <https://support.apple.com/100100>.
- [ ] Record the required physical-device video using the script in section 5. The recording must start by launching TaskKin Care.
- [ ] Create and verify permanent App Review credentials. At minimum provide a Coordinator account; preferably also provide Caregiver and Viewer accounts in the same sample household.
- [ ] Verify a sandbox monthly or yearly purchase, entitlement activation, restore purchase after reinstall, and the subscription-management link on the physical device.
- [ ] Verify account deletion on a separate disposable account. Do not delete the permanent Coordinator review account.
- [x] Fix and locally test the non-Coordinator account-deletion database path. **Implemented in migration `0053_rewrite_delete_account_data.sql` + the `delete-account` Edge Function.** `delete_account_data` no longer hard-deletes membership rows. Coordinated households cascade-delete; memberships in other households are anonymized (soft-deleted: `user_id = NULL`, `invite_status = 'removed'`, name replaced with a "Deleted member" placeholder) so restrictive member FKs remain valid. Storage cleanup uses a persistent retry queue so an interrupted deletion cannot permanently lose its cleanup targets. Local proof: `backend/qa/delete_account_regression.sql` + `src/__tests__/delete-account-migration.test.ts`.
- [x] Choose one truthful audit-retention behavior and align the app, database, Privacy Policy, and deletion page. **Chosen: coordinated households cascade-delete ALL household data including audit records; memberships in other (non-coordinated) households are anonymized and their audit records remain attributable to the "Deleted member" placeholder, subject to the household plan's normal retention window (30 days Free / 3 years Plus).** The app confirm dialog, `site/privacy{,-zh,-es}.html`, `site/delete-account.html`, `site/terms{,-zh,-es}.html`, `site/privacy.md`, `docs/legal/PRIVACY_POLICY.md`, and `docs/legal/TERMS_OF_SERVICE.md` all state this. The outdated "audit records retained for 24 months" claim has been removed.
- [x] Clarify multi-household deletion wording. **The UI now says "Delete account & households" and the confirm dialog states that every coordinated household is deleted and other memberships are anonymized** (EN/zh/es).
- [ ] Confirm the physical-device model names and iOS versions in Settings > General > About, then replace every bracketed placeholder below.
- [ ] Attach both iOS subscription products to the submitted app version and confirm both are Ready to Submit.
- [x] Bump the iOS build number to `2` and verify the regenerated Release product carries version `1.0.0 (2)`.
- [ ] Deploy the updated `site/` files, then open the support, privacy, terms, and account-deletion URLs from the review device. All four currently return HTTP 200, but the live privacy/deletion pages still contain the superseded 24-month audit-retention wording until these local changes are pushed.
- [ ] Restore the linked Supabase project, deploy migration `0053` and the updated `delete-account` function, then run `backend/qa/delete_account_regression.sql`. The project is currently `INACTIVE`; Supabase refused restoration because the organization owner is already at the two-active-free-project limit. Pause/delete another project or upgrade first.
- [x] Apply safe dependency patches and document the remaining upstream risk. `js-yaml`, `nanoid`, and `postcss` were patched; `expo-doctor` passes 20/20. The official registry now reports 12 high and 8 moderate transitive advisories: Metro `image-size` has no fix, while the Expo/xcode `uuid` path requires a breaking Expo downgrade. Do not use `npm audit fix --force`.

## 2. Complete feature inventory

| Area                     | Current behavior                                                                                                                                                                                                                                                                     | Who can use it                                                                          | Reviewer path / evidence                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------ |
| First launch and consent | Blocks use until the user accepts the Privacy Policy and Terms; EN, Simplified Chinese, and Spanish are available                                                                                                                                                                    | Everyone                                                                                | Cold launch                                |
| Registration and login   | Email/password sign-up, sign-in, password reset, and sign-out                                                                                                                                                                                                                        | Everyone                                                                                | Launch > Create account / Sign in          |
| Code/QR join             | A family member can join with a 6-digit code using an anonymous Supabase session; QR scanning is optional                                                                                                                                                                            | Invited household members                                                               | Sign in screen > Join a family             |
| Household onboarding     | Create a household and become its Coordinator, or join an existing household                                                                                                                                                                                                         | Signed-in users                                                                         | After first authentication                 |
| Multi-household          | List, switch, and create up to the plan limit                                                                                                                                                                                                                                        | Signed-in users; additional households require Plus                                     | Settings > Households                      |
| Home                     | Open/completed/owned/critical metrics, next actions, role capabilities, role notifications, and notification preferences                                                                                                                                                             | All roles, filtered by permission                                                       | Home                                       |
| Tasks                    | Template or custom creation; claim, reject, request/accept handoff, complete with proof, and delete                                                                                                                                                                                  | Coordinator/Caregiver; Viewer cannot access the Tasks tab                               | Tasks                                      |
| Timeline                 | Add template/custom coordination events, optionally create a related task, filter by type/member, and delete authorized entries                                                                                                                                                      | Coordinator/Caregiver can add; Viewer can read                                          | Timeline                                   |
| Documents                | Select an image or PDF up to 25 MB, upload to private household storage, review OCR output, and explicitly confirm before creating a task                                                                                                                                            | Coordinator/Caregiver; Viewer cannot access documents                                   | Docs                                       |
| OCR                      | Apple Vision text recognition runs on-device in the iOS production build; extracted text is assistive and requires manual confirmation                                                                                                                                               | Users with document permission                                                          | Docs > Upload document                     |
| Reports                  | Generate a non-clinical weekly coordination summary and save report history                                                                                                                                                                                                          | Coordinator; Caregiver has report permission but cloud history save is Coordinator-only | Settings > Weekly report                   |
| PDF/CSV export           | Export weekly/task data through the iOS share sheet                                                                                                                                                                                                                                  | Family Plus                                                                             | Weekly report modal                        |
| Notifications            | Local role-aware notifications, critical-task bypass, digest queue, and quiet-hours behavior                                                                                                                                                                                         | Household members; advanced controls require Plus                                       | Home > Notification controls               |
| Roles and members        | Coordinator/Caregiver/Viewer permissions, 6-digit invite code, role changes, member removal, self-name update, leave household, and dissolve household                                                                                                                               | Coordinator manages roles/removal; members can leave                                    | Settings                                   |
| Audit trail              | Append-only display of important household actions                                                                                                                                                                                                                                   | Coordinator only                                                                        | Settings > Recent audit > View all         |
| Subscription             | Monthly/yearly auto-renewable Family Plus, StoreKit-localized prices, restore purchase, and manage subscription                                                                                                                                                                      | Coordinator only; entitlement applies to the household                                  | Settings > Plan                            |
| Account deletion         | Coordinated households cascade-delete with all data/audit; other memberships are anonymized to preserve shared records and restrictive FKs. Migration `0053` adds retryable Storage cleanup. Local guards pass; remote deployment/regression is required after Supabase restoration. | Any signed-in account after backend deployment                                          | Settings > Delete account & households     |
| Languages                | English, Simplified Chinese, and Spanish, switchable in-app                                                                                                                                                                                                                          | Everyone                                                                                | Top language button                        |
| Privacy boundaries       | No ads, no tracking, no ATT, no social login, no public feed, and no external cloud AI/OCR service                                                                                                                                                                                   | Not applicable                                                                          | Privacy disclosures and code configuration |

### Role summary

- **Coordinator:** household/member management, tasks, timeline, documents, reports, audit, and household subscription management.
- **Caregiver:** tasks, timeline, documents, and reports; cannot manage household roles, view the audit trail, or purchase the household subscription.
- **Viewer:** read-only Home/Timeline/Settings experience; no Tasks or Documents tab.

### Private user-created content

Members create tasks, timeline entries, and private documents. This content is visible only inside an invited household and is protected by household row-level security and role permissions. There is no public feed, user discovery, open messaging, stranger interaction, comments, or public profile. Therefore a public-content report/block system is not applicable. A Coordinator can remove a household member, and any non-Coordinator can leave a household. Users can contact support at `Billy.yu@me.com`.

## 3. Detailed response source

Apple's Resolution Center Reply field and App Review Notes field each allow up to 4,000 characters/bytes. The detailed response below is the authoritative source for all eight requested topics, but it is intentionally longer than that limit. Do **not** paste it as one Reply. Use the compact companion text in section 4 for both the Reply and Notes, and keep this detailed version as the internal checklist/source of truth. Apple documents the Notes limit here: <https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information>. Do not submit it until every blocking item in section 1 is complete.

```text
Dear App Review Team,

Thank you for the opportunity to provide additional information. We have attached a physical-device screen recording and included all requested details below. The submitted build is TaskKin Care 1.0.0 ([BUILD NUMBER]).

1. PHYSICAL-DEVICE SCREEN RECORDING

Attachment: [VIDEO FILENAME]
Recorded on: [PHYSICAL IPHONE MODEL], iOS [IOS VERSION], on [TEST DATE]

The recording begins with launching TaskKin Care and demonstrates the first-launch consent screen; account registration; login; household creation and 6-digit/QR joining; the Home, Tasks, Timeline, Docs, and Settings flows; role-based access; task creation, claim/reject, handoff, completion, and deletion; timeline entry creation; private document upload; on-device OCR and explicit manual confirmation; notification and camera permission prompts; weekly report generation and PDF/CSV export; Family Plus monthly/yearly subscription information, purchase, restore, and management; member removal/leave controls; and in-app account deletion.

TaskKin Care contains private household-created content (tasks, timeline entries, and documents), but it has no public feed, user discovery, open messaging, comments, or interaction with strangers. Content is restricted to invited household members using role-based access. A Coordinator can remove a member, and a member can leave a household, so a public-content reporting or blocking flow is not applicable.

The app requests notification permission for local coordination alerts. Camera permission is requested only when the user chooses to scan a family join QR code; the user can enter the 6-digit code manually instead. The app does not request location, contacts, microphone, or App Tracking Transparency permission. Document selection uses the iOS system file picker.

2. DEVICES AND OPERATING SYSTEMS TESTED

- [PHYSICAL DEVICE 1 MODEL] - iOS [VERSION] - physical device - TestFlight build [BUILD] - tested [DATE]
- [PHYSICAL DEVICE 2 MODEL] - iOS [VERSION] - physical device - TestFlight build [BUILD] - tested [DATE]

Additional pre-submission simulator coverage was completed on iPhone 17, iPhone 17 Pro, and iPhone 17 Pro Max with iOS 26.5 using the Release configuration. The attached recording and final acceptance testing use a physical device on the latest iOS release.

3. FUNCTIONS, TARGET AUDIENCE, PROBLEM, AND VALUE

TaskKin Care is a non-clinical family care coordination app for adult family members and trusted caregivers who are organizing everyday support for a relative. It replaces fragmented group chats, notes, and memory with one household-scoped workspace containing shared tasks, explicit responsibility, handoffs, a care timeline, private documents, role-aware notifications, weekly coordination reports, and an audit trail.

The app does not diagnose, treat, prescribe, provide emergency triage, process insurance or billing, or integrate with medical records. It is not a medical device or telehealth service. Its value is organizational: every task has a visible status and owner, family members can coordinate changes, and authorized members can review what happened and when.

4. SETUP AND ACCESS INSTRUCTIONS

Please use the preconfigured Coordinator account below. It already belongs to a sample household with fictional test data and has access to every reviewable feature and the Family Plus purchase location.

Coordinator email: [COORDINATOR REVIEW EMAIL]
Coordinator password: [COORDINATOR REVIEW PASSWORD]

Optional role-specific accounts in the same household:
Caregiver email: [CAREGIVER REVIEW EMAIL]
Caregiver password: [CAREGIVER REVIEW PASSWORD]
Viewer email: [VIEWER REVIEW EMAIL]
Viewer password: [VIEWER REVIEW PASSWORD]

After login:
- Home: metrics, next actions, private household notifications, and notification controls.
- Tasks: create a template/custom task, then claim, reject, hand off, complete, or delete it.
- Timeline: add and filter coordination events.
- Docs: confirm the non-PHI safety notice, tap Upload document, and select the attached file `taskkin-care-review-sample-schedule.pdf`. OCR runs on-device. Review the extracted suggestion and tap Confirm and create task.
- Settings: household switching, invite code/QR, role/member management, weekly reports, audit trail, legal links, Family Plus, and account deletion.

To test registration, use Create account with a new test email and password. To test password recovery, use Forgot password. To test joining without email, choose Join a family and enter a valid 6-digit household code and display name; the camera/QR path is optional.

Please do not delete the permanent Coordinator review account. Use [DISPOSABLE DELETION ACCOUNT EMAIL] / [DISPOSABLE DELETION ACCOUNT PASSWORD] for the account-deletion test.

5. EXTERNAL SERVICES, TOOLS, AND PLATFORMS

- Supabase: email/password and anonymous authentication, PostgreSQL database, Realtime synchronization, private object storage, and Edge Functions.
- Apple StoreKit 2 and App Store Server Notifications: subscription purchase, signed transaction verification, restore, renewal, cancellation, refund, and expiration state.
- Apple Vision: on-device OCR in the iOS app. Document content is not sent to an external AI/OCR provider for recognition.
- Apple system services: local notifications, camera QR scanning, document picker, share sheet, and printing/PDF generation.
- GitHub Pages: public support, Privacy Policy, Terms of Service, and account-deletion information pages.
- Expo/React Native: native application framework and build tooling.

There are no advertising, analytics, tracking, social-login, external LLM, or cloud AI/OCR services in the submitted iOS build. Google Play Billing code is used only by the separate Android build and is not called on iOS.

6. REGIONAL DIFFERENCES

Core functionality and content are consistent in every available region. Users can select English, Simplified Chinese, or Spanish regardless of region. App Store subscription price and currency are localized by the user's storefront. There are no region-locked care features, data-provider differences, or location-based content restrictions.

7. REGULATED INDUSTRY OR PROTECTED THIRD-PARTY MATERIAL

Not applicable. TaskKin Care is a general family organization and coordination tool, not a medical device, healthcare provider, telehealth service, pharmacy, insurer, emergency service, or clinical decision-support product. It does not bundle licensed medical databases or protected third-party media. Users may upload only private files they are authorized to share, and the app requires a non-PHI safety acknowledgment before document upload. No professional license or third-party content credential is required for the service offered by this app.

8. IN-APP PURCHASE

Family Plus is an optional auto-renewable household subscription. Only the household Coordinator can purchase or restore it because one subscription unlocks benefits for the household.

- Family Plus Monthly - product ID `TaskKin.care.pro.mon` - 1 month - StoreKit-localized price.
- Family Plus Yearly - product ID `TaskKin.care.pro.yearly` - 1 year - StoreKit-localized price.

Family Plus unlocks up to 3 households, up to 12 members per household, unlimited in-progress tasks, 50 document OCR uploads per month, PDF/CSV report export, digest and quiet-hours notification controls, automatic weekly reports with history, and 3-year audit retention. Free includes 1 household, 3 members, 10 in-progress tasks, 1 OCR upload per month, manual weekly reports, and 30-day audit retention.

Purchase path: sign in with the Coordinator account > Settings > Plan > Upgrade to Family Plus > choose the monthly or yearly option. The paywall shows the subscription duration, StoreKit-localized price, auto-renewal disclosure, Restore Purchase, Terms of Service, and Privacy Policy. After purchase, Settings > Plan > Manage Plan opens Apple's subscription-management page.

Deleting a TaskKin Care account does not automatically cancel an Apple subscription; the user can cancel it through Apple's subscription settings.

Support: Billy.yu@me.com
Privacy Policy: https://junyu17.github.io/relaycare/privacy.html
Terms of Service: https://junyu17.github.io/relaycare/terms.html
Support URL: https://junyu17.github.io/relaycare/

Please let us know if any additional access or information would be helpful. Thank you for reviewing TaskKin Care.
```

## 4. Resolution Center Reply and App Review Information Notes

Use the companion file `docs/APP_REVIEW_NOTES_READY_TO_PASTE_2026-08-14.txt` for both the Resolution Center Reply and the App Review Information Notes field. Replace all placeholders and recheck that the final text remains below 4,000 bytes before pasting.

## 5. Physical-device recording script

Use the exact TestFlight candidate build. Prefer one continuous recording, approximately 8-12 minutes, with no personal notifications or real family data visible.

### Before recording

1. Update the physical iPhone to iOS 26.6 and confirm the exact device model and version in Settings > General > About.
2. Install the new TestFlight candidate and place `taskkin-care-review-sample-schedule.pdf` in the Files app.
3. Use only fictional names: Avery Chen, Morgan Lee, and Jordan Rivera are safe examples.
4. Prepare:
   - a permanent Coordinator review account with sample data;
   - optional Caregiver and Viewer review accounts;
   - a separate disposable account for registration/deletion;
   - an active sandbox Apple ID that can purchase the submitted IAP products.
5. Reset camera and notification permissions so both prompts appear naturally.
6. Enable Do Not Disturb for unrelated apps, hide email/Apple ID details, and remove any real documents or photos from recent pickers.
7. Confirm the paywall displays live StoreKit-localized prices. Do not record fallback prices caused by unavailable products.

### Shot list

| Time | Action                                                                                                  | What Apple should see                              |
| ---- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 0:00 | Start on the iPhone Home Screen and tap TaskKin Care                                                    | The recording begins with app launch as requested  |
| 0:05 | Review first-launch consent; open Privacy/Terms briefly; accept                                         | Legal disclosure and language options              |
| 0:35 | Tap Create account and register the disposable account                                                  | Registration works                                 |
| 1:00 | Create a household, then sign out                                                                       | Coordinator onboarding and sign-out                |
| 1:30 | Sign in with the permanent Coordinator review account                                                   | Login and prepared sample data                     |
| 1:50 | Home: metrics, next actions, role permissions, notifications                                            | Typical overview                                   |
| 2:20 | Tasks: create a custom task; claim/reject; show handoff target; complete one task                       | Core task lifecycle                                |
| 3:20 | Timeline: add a coordination update and filter by event/member                                          | Timeline core flow                                 |
| 4:00 | Docs: acknowledge non-PHI notice, upload the sample PDF, review OCR, confirm and create task            | File picker, on-device OCR, and human confirmation |
| 5:00 | Open QR join scanner, grant camera permission, then close and show manual code entry                    | Sensitive camera prompt and optional fallback      |
| 5:35 | Show the notification permission prompt and notification controls                                       | Sensitive notification prompt and purpose          |
| 6:00 | Settings: invite code/QR, roles, remove member control, audit trail, weekly report, PDF/CSV export      | Household controls and private-content safeguards  |
| 7:10 | Settings > Plan > Upgrade; show monthly/yearly duration, localized price, legal links, Restore Purchase | Subscription disclosure                            |
| 7:50 | Complete one sandbox purchase or restore and show Plus active; open Manage Plan                         | Paid access and management                         |
| 8:40 | Sign out; sign into the disposable account; Settings > Delete account & households; confirm             | In-app account deletion                            |
| 9:30 | End on the sign-in screen                                                                               | Deletion completed and session ended               |

If one continuous recording becomes too long, attach a primary core-flow recording plus a clearly named second recording for IAP and deletion, but explicitly list both filenames in the reply.

## 6. Device matrix to complete

The local Mac currently remembers two physical devices, both offline during this audit:

- `Billys17Air` - iOS 26.6 - exact hardware model must be confirmed on-device.
- `Jufei iP12` - iOS 26.6 - the name suggests iPhone 12, but the exact model must still be confirmed on-device.

Do not paste device nicknames into App Store Connect. Use Apple's model names and record the exact TestFlight build and date.

| Device model                  | OS       | Physical / simulator | Build          | Core flow | IAP/restore   | OCR/export | Permissions | Delete account | Date       |
| ----------------------------- | -------- | -------------------- | -------------- | --------- | ------------- | ---------- | ----------- | -------------- | ---------- |
| [Exact model for Billys17Air] | iOS 26.6 | Physical             | [BUILD]        | [PASS]    | [PASS]        | [PASS]     | [PASS]      | [PASS]         | [DATE]     |
| iPhone 12 [exact variant]     | iOS 26.6 | Physical             | [BUILD]        | [PASS]    | Optional      | [PASS]     | [PASS]      | [PASS]         | [DATE]     |
| iPhone 17                     | iOS 26.5 | Simulator, Release   | prior QA build | PASS      | Not supported | Partial    | Partial     | Not final      | 2026-08-04 |
| iPhone 17 Pro                 | iOS 26.5 | Simulator, Release   | prior QA build | PASS      | Not supported | Partial    | Partial     | Not final      | 2026-08-04 |
| iPhone 17 Pro Max             | iOS 26.5 | Simulator, Release   | prior QA build | PASS      | Not supported | Partial    | Partial     | Not final      | 2026-08-04 |

## 7. Review account and sample data specification

### Permanent Coordinator review account

- Must be email/password based and remain valid throughout review.
- Must already be a Coordinator in a household called `App Review Family`.
- Use only fictional member names and non-clinical data.
- Seed at least:
  - 2 open tasks, including 1 critical task;
  - 1 claimed task and 1 completed task;
  - 3 timeline events of different types;
  - 1 pending OCR document or the attached sample PDF ready in Files;
  - 1 recent audit record for each main action class;
  - Family Plus entitlement only if you want Apple to inspect paid features without purchasing. Otherwise keep the account Free so the purchase path is visible.

### Optional role accounts

- Caregiver account in the same household to demonstrate task claim/handoff and restricted Settings.
- Viewer account in the same household to demonstrate read-only Timeline access and absence of Tasks/Documents/Audit.

### Disposable deletion account

- A separate email/password Coordinator account with its own disposable household.
- Do not attach an active subscription to it.
- Delete it only at the end of the recording.
- Separately test account deletion with a Caregiver or Viewer account that has created a task, timeline event, document, and audit entries. This is a release test, even if the shorter recording uses the disposable Coordinator account.

## 8. Files to attach or make available

Use stable, descriptive names:

- `[APP]-physical-device-core-flow-build-[BUILD].mov`
- `[APP]-iap-and-account-deletion-build-[BUILD].mov` if a second recording is needed
- `taskkin-care-review-sample-schedule.pdf`
- Optional `taskkin-care-review-credentials.txt` containing only the review credentials and navigation instructions

Do not put production API keys, service-role keys, App Store Connect credentials, personal Apple IDs, or real user data in any attachment.

## 9. App Store Connect resubmission checklist

### Build

- [ ] Set `app.json` `ios.buildNumber` to the next unused number.
- [ ] Build and archive the exact commit being submitted.
- [ ] Upload and install that build through TestFlight.
- [ ] Re-run the physical-device matrix against that exact build.

### Subscriptions

- [ ] Subscription group localized in EN, zh-Hans, and ES.
- [ ] `TaskKin.care.pro.mon` is Ready to Submit with duration, price, localization, and review screenshot.
- [ ] `TaskKin.care.pro.yearly` is Ready to Submit with duration, price, localization, and review screenshot.
- [ ] Both products are attached to this app version under In-App Purchases and Subscriptions.
- [ ] Agreements, Tax, and Banking are active.
- [ ] Sandbox purchase and restore work in the TestFlight build.
- [ ] Remote Apple receipt verification accepts the sandbox transaction during review. A secret named `APPLE_ACCEPTED_ENVIRONMENTS` exists remotely, but its value cannot be read back; the real sandbox transaction is the required proof.

### App Review Information

- [ ] Replace every placeholder in the full response and compact Notes.
- [ ] Enter stable Coordinator credentials and optional role credentials.
- [ ] Attach the physical-device recording(s).
- [ ] Include the sample PDF or state that it is already available in the review account/device.
- [ ] Include a reachable phone number and support email.

### Privacy and legal

- [ ] App Privacy declares Email Address, Name, User Content, User ID, and Purchases as collected, linked to identity, not used for tracking, for App Functionality.
- [ ] Tracking is No; third-party advertising is No.
- [ ] Confirm the Privacy Policy, Terms, Support, and deletion pages load on the review device and state the resolved deletion semantics (coordinated households deleted; other memberships anonymized; audit per-plan retention).
- [ ] Keep the non-clinical/non-PHI positioning consistent across metadata, screenshots, review notes, and in-app text.
- [ ] Re-test account deletion on a Caregiver/Viewer/disposable account with authored content and on a multi-household account against the new build (regression SQL is in `backend/qa/delete_account_regression.sql`).

### Final evidence

- [ ] Save the final `.xcarchive`, TestFlight build number, video filename, device model/OS, test date, IAP product statuses, and sandbox result in `docs/QA_Log.md`.
- [ ] Save screenshots of Plus active, Restore success, account deletion completion, camera prompt, notification prompt, and the OCR confirmation screen.

## 10. Audit evidence from this preparation pass

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 12 files / 75 tests passed.
- `npm run format:check`: passed.
- `npx expo-doctor`: 20/20 checks passed.
- iOS Release simulator build from the current source: `BUILD SUCCEEDED` on 2026-08-14.
- Final Release product metadata: bundle `cd.cc.relaycare`, version `1.0.0 (2)`, `ITSAppUsesNonExemptEncryption=false`, camera purpose string present, no ATT purpose string.
- Previously deployed Supabase functions reported ACTIVE, but the linked project is currently `INACTIVE`; the new `0053` migration and updated `delete-account` function are not deployed yet.
- Supabase restoration returned HTTP 403 because the organization owner has reached the two-active-free-project limit. This backend blocker must be cleared before uploading build 2.
- iOS native configuration contains the camera usage description, no microphone usage description, `ITSAppUsesNonExemptEncryption=false`, no push entitlement, and `NSPrivacyTracking=false`.
- Previous three-device Release simulator report covered iPhone 17 / 17 Pro / 17 Pro Max on iOS 26.5, but explicitly did not cover physical-device IAP, PDF/CSV share-sheet behavior, real notification timing, or final account deletion.

This evidence supports the documentation but does not replace Apple's required physical-device recording and final TestFlight acceptance test.
