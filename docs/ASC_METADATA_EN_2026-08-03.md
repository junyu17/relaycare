# App Store Connect Metadata — TaskKin Care (English / U.S. primary)

Prepared 2026-08-03. Fill the bracketed placeholders before submitting.
Character limits are noted per field; counts verified against Apple's limits.

---

## 1. App Name (30 char limit)

```
TaskKin Care
```

## 2. Subtitle (30 char limit)

```
Family caregiving, organized
```

Alternate options:

- `Shared care tasks for family` (28)
- `Coordinate care as a family` (27)

## 3. Promotional Text (170 char limit — editable without a new build)

```
Caring for someone shouldn't mean guessing who did what. TaskKin Care gives your family one shared list, clear owners, and a timeline everyone can trust.
```

## 4. Description (4,000 char limit)

```
Caring for a parent, partner, or relative is rarely one person's job — but it usually feels that way. Details live in group chats, sticky notes, and someone's memory. TaskKin Care gives your family one shared, calm place to coordinate.

ONE LIST, CLEAR OWNERS
Create care tasks, set due dates, and mark what's critical. Every task has one visible owner, so nothing sits in the gap between "I thought you had it" and "I thought you did."

ROLES THAT MATCH REAL FAMILIES
Not everyone should be able to do everything. Coordinators run the household, Caregivers claim and complete tasks, and Viewers stay informed without changing anything. Adjust roles as circumstances change.

HAND OFF WITHOUT DROPPING ANYTHING
When you can't cover a shift or an errand, request a handoff. The other person accepts explicitly, so responsibility always has a name attached.

A SHARED TIMELINE
Log updates as they happen using fixed, non-clinical entry templates. Anyone who joins later can catch up in minutes instead of reconstructing weeks of messages.

DOCUMENTS, SCANNED ON YOUR DEVICE
Add a photo or PDF of a discharge sheet, schedule, or checklist and let on-device text recognition pull out the key details. Scanning runs entirely on your iPhone — the text is never sent to a server for processing. Every suggestion requires your manual confirmation before it becomes a task.

INVITE FAMILY IN SECONDS
Share a 6-digit code or QR code. Relatives can join and start helping without creating an email account.

AN AUDIT TRAIL YOU CAN TRUST
Every meaningful change is recorded — who did what and when. Useful for coordinating between siblings, and for the conversations that are easier with a record.

AVAILABLE IN ENGLISH, SIMPLIFIED CHINESE, AND SPANISH
Switch languages at any time. Family members can each read the app in their own language.

WHAT TASKKIN CARE IS NOT
This is a coordination tool, not a medical one. It does not provide diagnosis, treatment advice, prescriptions, billing, emergency triage, or medical-record integration. It is designed for non-clinical coordination information and is not intended to store protected health information. In an emergency, contact your local emergency services.

FAMILY PLUS
Free includes 1 household, up to 3 members, 10 in-progress tasks, and 1 document scan per month.

Family Plus adds:
• Up to 3 households and 12 members
• Unlimited in-progress tasks
• 50 document scans per month
• Export reports as PDF or CSV
• Daily digest and quiet hours for notifications
• Automatic weekly reports with history
• 3-year audit history (30 days on Free)

Family Plus is an auto-renewing subscription, offered monthly or yearly. Payment is charged to your Apple Account at confirmation of purchase. It renews automatically unless canceled at least 24 hours before the end of the current period, and your account is charged for renewal within 24 hours prior to the end of the current period. You can manage or cancel your subscription in your Apple Account settings after purchase.

Terms of Use: https://junyu17.github.io/relaycare/terms.html
Privacy Policy: https://junyu17.github.io/relaycare/privacy.html
```

## 5. Keywords (100 char limit, comma-separated, no spaces)

```
caregiver,eldercare,caregiving,elderly,senior,family,carer,checklist,handoff,shared,tasks,todo
```

Notes:

- 94 characters.
- Deliberately excludes "TaskKin" and "Care" — words already in the app name are indexed automatically and would waste budget.
- Excludes clinical terms ("patient", "medical", "health record") to avoid attracting the wrong queries and to stay consistent with the non-clinical positioning.

## 6. What's New in This Version (v1.0.0)

```
The first release of TaskKin Care.

Share one caregiving list with your family, give every task a clear owner, hand off responsibility explicitly, and keep a timeline and audit trail everyone can rely on. Scan documents on-device, invite relatives with a 6-digit code, and use the app in English, Simplified Chinese, or Spanish.

We'd love your feedback — reach us at [SUPPORT EMAIL].
```

## 7. URLs

| Field                    | Value                                                                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Support URL              | `https://junyu17.github.io/relaycare/`                                                                                                                                                        |
| Marketing URL            | `https://junyu17.github.io/relaycare/`                                                                                                                                                        |
| Privacy Policy URL       | `https://junyu17.github.io/relaycare/privacy.html`                                                                                                                                            |
| License Agreement (EULA) | Use Apple's standard EULA, **or** paste `https://junyu17.github.io/relaycare/terms.html`. If you use your own, it must be entered in App Store Connect → App Information → License Agreement. |

✅ Verified 2026-08-03: the landing page already carries a `mailto:` contact link at the bottom (`Billy.yu@me.com`), so the Support URL requirement is satisfied. Use that same address for `[SUPPORT EMAIL]` below unless you want a separate support inbox.

## 8. Category & Ratings

| Field                    | Recommendation   | Why                                                                                                                                   |
| ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Primary category         | **Productivity** | The app is task/coordination software. Filing under Medical or Health & Fitness invites Guideline 1.4.1 scrutiny the app doesn't need |
| Secondary category       | **Lifestyle**    |                                                                                                                                       |
| Age rating               | **4+**           | No user-generated public content, no ads, no objectionable material                                                                   |
| Contains third-party ads | No               |                                                                                                                                       |
| Made for Kids            | No               |                                                                                                                                       |

## 9. App Privacy (Data collected)

Consistent with `ios/TaskKinCare/PrivacyInfo.xcprivacy` (`NSPrivacyTracking = false`, no tracking SDKs). Declare:

| Data type                                                  | Collected | Linked to identity | Used for tracking | Purpose                     |
| ---------------------------------------------------------- | --------- | ------------------ | ----------------- | --------------------------- |
| Email address                                              | Yes       | Yes                | No                | App Functionality (account) |
| Name (display name)                                        | Yes       | Yes                | No                | App Functionality           |
| User Content (tasks, timeline entries, uploaded documents) | Yes       | Yes                | No                | App Functionality           |
| Identifiers (user ID)                                      | Yes       | Yes                | No                | App Functionality           |
| Purchases (subscription status)                            | Yes       | Yes                | No                | App Functionality           |

Answer **No** to tracking across apps and websites, and **No** to third-party advertising.

## 10. App Review Notes

```
OVERVIEW
TaskKin Care is a coordination tool for families caring for a relative. It is
deliberately non-clinical: no diagnosis, treatment advice, prescriptions,
billing, emergency triage, or medical-record integration. The in-app banner on
the Home screen states this.

DEMO ACCOUNT (email confirmation is required for new sign-ups, so please use
this pre-verified account rather than registering)
  Email:    [DEMO EMAIL]
  Password: [DEMO PASSWORD]
This account is already a Coordinator of a household with sample data.

HOW TO REVIEW THE SUBSCRIPTION (Family Plus)
1. Sign in with the demo account above.
2. Go to the Settings tab.
3. Under "Plan", tap "Upgrade to Family Plus".
4. The paywall shows the Free/Plus comparison, StoreKit-localized pricing,
   subscription length, "Restore purchase", and links to our Terms of Use and
   Privacy Policy.
5. Choose the yearly or monthly option to complete a sandbox purchase.

IMPORTANT — PURCHASES ARE COORDINATOR-ONLY (this is intended behavior)
Family Plus is billed per household, not per person, so only the household
Coordinator can purchase or restore it. Members who joined via a 6-digit code
are Caregivers or Viewers and will see a message explaining that only a
Coordinator can manage the plan. The demo account above is a Coordinator, so
the purchase flow is fully available to you.

If you prefer to start from scratch: after signing in, create a new household —
whoever creates a household automatically becomes its Coordinator.

WHAT FAMILY PLUS UNLOCKS (all testable in-app after purchase)
  • Up to 3 households and 12 members (Free: 1 and 3)
  • Unlimited in-progress tasks (Free: 10)
  • 50 document scans per month (Free: 1)
  • Export reports as PDF or CSV (Settings > Generate report > Export)
  • Notification digest and quiet hours (Home > notification controls)
  • Automatic weekly reports with history (Settings > Generate report > History)
  • 3-year audit history (Free: 30 days)

CAMERA PERMISSION
The camera is used only to scan a family join QR code, on the join screen.
You can skip it by typing the 6-digit code manually.

DOCUMENT SCANNING / OCR
Text recognition runs entirely on-device using Apple Vision. Document text is
not sent to any server for processing. Every extracted suggestion requires
explicit manual confirmation before it creates a task.

ACCOUNT DELETION
Settings tab > "Delete account & household data". This permanently deletes the
account, the household, and all associated data.

LANGUAGES
English, Simplified Chinese, and Spanish. Switch via the language button in the
top bar.

CONTACT
[SUPPORT EMAIL] — happy to answer any questions or provide additional
credentials during review.
```

## 11. Pre-submission checklist for these fields

- [ ] `[DEMO EMAIL]` / `[DEMO PASSWORD]` replaced with a real, **email-confirmed** account that is a Coordinator with sample data
- [ ] `[SUPPORT EMAIL]` replaced, and the same address is visible on the Support URL page
- [ ] Description's Family Plus benefit list matches what actually ships (see `IOS_SUBMISSION_DEV_SPEC_2026-08-03.md` R4–R8) — do **not** submit this description until those land
- [ ] Actual monthly/yearly prices in App Store Connect match the subscription terms paragraph
- [ ] Terms of Use entered in App Information → License Agreement (not only in the description)
- [ ] Screenshots re-captured after the remediation build, with no real third-party names in the demo data
