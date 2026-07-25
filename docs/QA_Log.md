# RelayCare MVP QA Log

This file records delivery checks for the local MVP scaffold.

## 2026-07-22

### Stage: MVP scaffold and core collaboration loop

Original requirement match:

- Confirmed current workspace and root `AGENTS.md` before implementation.
- Used `/Users/jun/Documents/RelayCare_项目立项/RelayCare_家庭照护协同平台_立项方案_v1.0.pdf` as project basis.
- Created an independent React Native + TypeScript Expo MVP in `/Users/jun/Documents/Project.app/relaycare-mvp`.
- Implemented non-PHI MVP scope: household, roles and permissions, task claim/reject/handoff/complete, care timeline, role notification controls, weekly report, basic document upload metadata, document confirmation, and audit trail.
- Kept explicit exclusions in UI and docs: no diagnosis, prescription, billing/payment, emergency triage, or deep EMR/EHR integration.

Independent quality review:

- Verified all write-like operations append `AuditEvent`: task claim, reject, handoff, complete, notification preference update, document upload, document confirmation, document-derived task creation, and report generation.
- Verified role permission checks block viewer/helper actions where permissions are absent.
- Verified document workflow requires manual confirmation before creating a task from candidate metadata.
- Verified notification preferences keep critical due alerts locked on while allowing audited non-critical digest changes.
- Verified weekly report is sourced from tasks and events and includes coordination-only boundary text.

Actual artifact verification:

- `npm install` completed.
- `npx expo install --check` passed after aligning React, React DOM, and TypeScript with Expo SDK 57.
- `npm run typecheck` passed.
- `npm run web -- --port 8082 --clear` loaded successfully.
- Playwright smoke test passed: home loads, notification digest toggle writes audit, task claim changes owner, sample document upload appears, document confirmation creates task, weekly report generates, and audit page shows `notification.preference_updated`, `task.claimed`, `document.task_created`, and `report.generated`.
- Visual screenshots reviewed for mobile and desktop: `docs/qa-mobile-home.png`, `docs/qa-mobile-report.png`, `docs/qa-mobile-audit.png`, and `docs/qa-desktop-home.png`.
- `npx expo export --platform web --output-dir web-build` completed.
- Served static build at `http://localhost:8082`; Playwright smoke test passed against the served static build.

Known limitations for next stage:

- Data is in local React state only; backend API, durable storage, auth, object storage, push/email delivery, and real invite links are not yet implemented.
- File upload records only non-PHI metadata in this scaffold; no production storage, scanning, watermarking, or signed URLs yet.
- OCR/AI is represented as manual candidate confirmation only; no external OCR/LLM integration is used.

### Stage: multilingual UI switch

Original requirement match:

- Default UI language remains English.
- Added a compact top-right language switch button.
- Added Chinese and Spanish language options; the button cycles EN -> Chinese -> Spanish.
- Localized Home, Tasks, Timeline, Docs, Report, Audit, modal titles, tab labels, alerts, buttons, task/example content, document status, audit labels/details, and generated weekly report text.

Independent quality review:

- Verified language switching does not change task state, role permissions, audit creation, or the non-PHI boundary.
- Verified new task/document/report actions generate text in the active language.
- Verified existing sample tasks, events, documents, member relations, notification copy, and audit details display in the active language.
- Fixed report modal behavior so the report body re-renders when language changes without writing duplicate audit events.
- Fixed report modal layout by putting the report body in an internal scroll area so the close button remains reachable.

Actual artifact verification:

- `npm run typecheck` passed.
- `npx expo install --check` passed.
- `npx expo export --platform web --output-dir web-build` passed.
- Static preview served at `http://localhost:8082`.
- Playwright multilingual smoke test passed: default English home, Chinese home, Chinese notification toggle, Chinese task claim, Chinese sample document confirmation, Chinese report generation, language switch while report modal is open, Spanish report modal, modal close, Spanish audit page, and desktop Chinese home.
- Visual screenshots reviewed: `docs/qa-i18n-en-home.png`, `docs/qa-i18n-zh-home.png`, `docs/qa-i18n-zh-report.png`, `docs/qa-i18n-es-report-modal.png`, `docs/qa-i18n-es-audit.png`, and `docs/qa-i18n-desktop-zh-home.png`.

### Stage: in-app role settings and role-based navigation

Original requirement match:

- Confirmed a separate web admin is not required for this MVP path.
- Added App-based role settings inside the same mobile app.
- Added `member:role_update` permission for Coordinators only.
- Added a Settings tab where Coordinators can change other members' roles and non-Coordinators can only view role permissions.
- Implemented same-app role differences: bottom tabs and task actions are filtered by the active member's role.

Independent quality review:

- Verified Coordinator can change another member from Family member to Viewer.
- Verified role changes write `member.role_updated` audit events with target member and new role.
- Verified Coordinator cannot change their own role in the MVP UI.
- Verified Viewer cannot see Tasks, Docs, Report, or Audit tabs after role change; Viewer sees only Home, Timeline, and Settings.
- Verified task action buttons are hidden when the active role lacks task permissions.
- Verified Settings page is localized in English and Chinese.

Actual artifact verification:

- `npm run typecheck` passed.
- `npx expo install --check` passed.
- `npx expo export --platform web --output-dir web-build` passed.
- Static preview served at `http://localhost:8082`.
- Playwright settings smoke test passed: Coordinator role update, audit detail, non-Coordinator view-only settings, Viewer tab filtering, and Chinese Settings page.
- Visual screenshots reviewed: `docs/qa-settings-en-role-update.png`, `docs/qa-settings-viewer-filtered-tabs.png`, and `docs/qa-settings-zh-view-only.png`.

### Stage: in-app task creation

Original requirement match:

- Added App-based creation of concrete help requests; no web admin is required.
- Added `task:create` permission for Coordinator and Family member roles.
- Added a New help request panel in Tasks with three owner-ready templates: ride, paperwork call, and supply pickup.
- Created tasks enter the claimable pool immediately and can be claimed by permitted family members.
- Created tasks write `task.created` audit events.

Independent quality review:

- Verified Helper and Viewer roles do not receive task creation permission.
- Verified role-based navigation still filters tabs after role changes.
- Verified claimed tasks no longer show Claim/Reject actions and show only relevant Handoff/Complete actions for permitted owners.
- Verified generated task audit details include the creator and task title.
- Verified all new task creation UI strings are localized in English, Chinese, and Spanish.

Actual artifact verification:

- `npm run typecheck` passed.
- `npx expo install --check` passed.
- `npx expo export --platform web --output-dir web-build` passed.
- Static preview served at `http://localhost:8082`.
- Playwright smoke test passed: create ride request, verify task appears, switch to Eli, claim task, verify owner changes, verify audit includes task creation and claim.
- Visual screenshots reviewed: `docs/qa-task-create-en.png`, `docs/qa-task-create-claim-en.png`, and `docs/qa-task-create-settings-zh.png`.

### Stage: simplified roles and navigation

Original requirement match:

- Clarified the apparent "12 roles" issue: the product now has 3 role types, not 12 visible role choices.
- Reduced roles to Coordinator, Caregiver, and Viewer.
- Removed Report and Audit from the primary bottom navigation; authorized users now access them from Settings as secondary tools.
- Replaced raw permission IDs with plain-language capability labels.
- Changed role management from expanded per-member role buttons to one Change button per editable member plus a 3-option role picker.
- Simplified non-Coordinator Settings so ordinary users see only their own role and access summary.

Independent quality review:

- Confirmed the core permission model still enforces role-based tabs and actions.
- Confirmed Coordinators can still manage member roles, generate weekly reports, and read recent audit entries.
- Confirmed Viewers cannot see Tasks, Docs, Report, Audit, Change buttons, or advanced tools.
- Confirmed the app remains inside the same mobile-app flow; no separate web admin was introduced.
- Confirmed the non-PHI MVP boundary text remains visible and no diagnosis, prescription, payment, or deep EMR workflow was added.

Actual artifact verification:

- `npm run typecheck` passed.
- `npx expo install --check` passed before the final UI edits; no package changes were introduced afterward.
- `npx expo export --platform web --output-dir web-build` passed.
- Static preview served at `http://localhost:8082`.
- Browser UI verification passed: default English home has 5 bottom tabs, no Report/Audit tab, no raw permission IDs, and no legacy Family/Helper roles.
- Browser UI verification passed: Coordinator Settings shows 3 Change buttons, no expanded role-choice grid, More tools with Weekly report and Recent audit, and no raw permission IDs.
- Browser UI verification passed: Viewer Settings shows only the viewer's own role panel; bottom navigation is Home, Timeline, Settings; Tasks and Docs are hidden.
- Browser UI verification passed: Chinese Viewer Settings shows only `首页 / 时间线 / 设置`, localized role text, and no raw permission IDs.
- Visual screenshots reviewed: `docs/qa-simplified-home-en.png`, `docs/qa-simplified-coordinator-settings-en.png`, `docs/qa-simplified-settings-en.png`, `docs/qa-simplified-viewer-settings-en.png`, and `docs/qa-simplified-viewer-settings-zh.png`.

### Stage: role-based notifications and handoff picker

Original requirement match:

- Strengthened the original role-based notification scope with an in-app role notification feed.
- Added non-PHI `RoleNotification` records targeted to Coordinator, Caregiver, Viewer, or all roles.
- Added notifications for task creation, claim, reject, handoff, completion, role update, document upload, document-derived task creation, and weekly report generation.
- Replaced automatic task handoff target selection with an in-app handoff picker.
- Kept handoff candidates role-gated: only members with task claim permission appear, and Viewers are excluded.
- Tightened task handoff action visibility so only a Coordinator or the current task owner can request handoff.

Independent quality review:

- Confirmed Coordinator and Caregiver see different role notification feeds.
- Confirmed role notifications contain coordination metadata only and no clinical/PHI payload.
- Confirmed Viewer role still cannot see Tasks, Docs, advanced tools, or handoff actions.
- Confirmed handoff still writes `task.handoff_requested` audit events and updates task state.
- Confirmed no diagnosis, prescription, payment, or EMR workflow was added.

Actual artifact verification:

- `npm run typecheck` passed.
- `npx expo install --check` passed.
- `npx expo export --platform web --output-dir web-build` passed.
- Static preview served at `http://localhost:8082`.
- Browser UI verification passed: Coordinator Home shows Coordinator weekly report notification but not Caregiver critical-task notification.
- Browser UI verification passed: Caregiver Home shows Caregiver critical-task notification but not Coordinator weekly report notification.
- Browser UI verification passed: Eli cannot hand off Sam's claimed task; Sam can open the handoff picker for Sam's own claimed task.
- Browser UI verification passed: handoff picker includes Maya and Eli, excludes Viewer Aunt Lee, and handoff to Eli updates task status.
- Browser UI verification passed: handoff creates a Caregiver notification and appears in Coordinator Recent audit.
- Browser UI verification passed: Chinese Settings/Audit strings for handoff remain localized.
- Visual screenshots reviewed: `docs/qa-role-notifications-home-en.png`, `docs/qa-role-notifications-caregiver-en.png`, `docs/qa-handoff-picker-precise-en.png`, `docs/qa-handoff-notification-en.png`, `docs/qa-handoff-audit-en.png`, and `docs/qa-handoff-audit-zh.png`.

### Stage: non-PHI timeline quick updates

Original requirement match:

- Expanded the care timeline from read-only filtering to controlled non-PHI timeline updates.
- Added `timeline:add` permission for Coordinator and Caregiver roles only.
- Added three quick timeline templates: check-in note, pickup plan, and paperwork reminder.
- Added explicit UI copy warning users not to enter diagnosis, medication, or clinical details.
- Added audit and role notification coverage for timeline updates.

Independent quality review:

- Confirmed the timeline entry mechanism uses fixed templates instead of free-text PHI-prone input.
- Confirmed Viewer can read the timeline but cannot see the quick-update creation controls.
- Confirmed new timeline events include owner, time, type, and non-PHI location metadata.
- Confirmed timeline updates create `timeline.event_added` audit records and Coordinator notifications.
- Confirmed existing task, document, role, and navigation permissions still compile and render.

Actual artifact verification:

- `npm run typecheck` passed.
- `npx expo export --platform web --output-dir web-build` passed.
- Static preview served at `http://localhost:8082`.
- Browser UI verification passed: Coordinator Timeline shows quick-update templates and non-PHI boundary copy.
- Browser UI verification passed: adding Check-in note creates a visible timeline event owned by Maya Chen.
- Browser UI verification passed: the new timeline event creates Coordinator Home notification and Recent audit entry.
- Browser UI verification passed: Viewer Timeline shows the new event but not quick-update controls; Viewer bottom tabs remain Home, Timeline, Settings.
- Browser UI verification passed: Chinese Timeline quick-update controls and boundary copy are localized.
- Visual screenshots reviewed: `docs/qa-timeline-add-en.png`, `docs/qa-timeline-audit-en.png`, `docs/qa-timeline-viewer-en.png`, and `docs/qa-timeline-add-zh.png`.

### Stage: in-app pending invites

Original requirement match:

- Expanded family and role permissions from role editing to in-app pending member invites.
- Added Coordinator-only invite templates for Caregiver and Viewer roles.
- Kept the invite flow inside the same app; no separate admin console was introduced.
- Created pending members with least-privilege role selection and default notification preferences.
- Avoided collecting email, phone, address, PHI, or other private identifiers in the MVP invite flow.
- Added role notification and audit coverage for member invites.

Independent quality review:

- Confirmed only Coordinators see the invite section.
- Confirmed pending invite members are visible for role management but cannot be selected as the active actor.
- Confirmed invited Caregiver role receives a role notification and the Coordinator audit list records `member.invited`.
- Confirmed Viewer role still cannot access invite controls or multi-member role management.
- Confirmed system-generated invite names localize in Chinese while real member names remain unchanged.
- Confirmed no diagnosis, prescription, payment, or EMR workflow was added.

Actual artifact verification:

- `npm run typecheck` passed.
- `npx expo install --check` passed.
- `npx expo export --platform web --output-dir web-build` passed.
- Static preview served at `http://localhost:8082`.
- Browser UI verification passed: Coordinator Settings shows invite templates and no-sensitive-data copy.
- Browser UI verification passed: creating a Caregiver invite adds a pending member, pending pill, role-change button, notification preference, and audit entry.
- Browser UI verification passed: pending invite actor chip is disabled.
- Browser UI verification passed: Caregiver Home shows the member-invited role notification.
- Browser UI verification passed: Viewer Settings does not show invite controls.
- Browser UI verification passed: Chinese Settings localizes invite section, pending labels, and generated invite member name.
- Visual screenshots reviewed: `docs/qa-invite-member-final-en.png`, `docs/qa-invite-member-caregiver-notification-en.png`, `docs/qa-invite-viewer-settings-en.png`, and `docs/qa-invite-member-final-zh.png`.

### Stage: document upload safety confirmation

Original requirement match:

- Strengthened basic file upload with an explicit non-PHI/redaction confirmation step.
- Added a user-facing confirmation that uploads must not include PHI, diagnosis, medication, or private identifiers.
- Blocked manual and sample upload paths until the confirmation is selected.
- Kept existing manual confirmation before document-derived task creation.
- Preserved document upload audit and role notification behavior.

Independent quality review:

- Confirmed the safety gate is UI-visible before upload actions.
- Confirmed confirmed sample upload still creates non-PHI document metadata and does not auto-write extracted fields.
- Confirmed document-derived task creation remains manual.
- Confirmed Chinese copy is localized.
- Confirmed no PHI storage, diagnosis, prescription, payment, or EMR workflow was introduced.

Actual artifact verification:

- `npm run typecheck` passed.
- `npx expo export --platform web --output-dir web-build` passed.
- Static preview served at `http://localhost:8082`.
- Browser UI verification passed: Docs page shows non-PHI notice and explicit safety confirmation.
- Browser UI verification passed: after confirmation, Sample upload creates a redacted sample document with manual confirmation action.
- Browser UI verification passed: Chinese Docs page shows localized safety confirmation and redacted sample document name.
- Code path verified: `onPickDocument` and `onAddSampleDocument` both block with `alerts.documentSafetyTitle` / `alerts.documentSafetyBody` until confirmation is selected.
- Visual screenshots reviewed: `docs/qa-document-safety-confirmed-en.png` and `docs/qa-document-safety-confirmed-zh.png`.

### Stage: local MVP state persistence

Original requirement match:

- Addressed reboot/reload continuity for the local MVP preview.
- Added versioned local persistence for non-PHI AppState data: members, invites, role notifications, notification preferences, tasks, timeline events, documents, and audit events.
- Kept language defaulting to English after new sessions.
- Kept document safety confirmation session-only so upload boundary must be confirmed again.
- Added Settings copy clarifying that MVP preview changes are saved on this device only and cloud sync is not enabled.

Independent quality review:

- Confirmed persisted state is normalized against the current schema and role definitions remain code-owned.
- Confirmed persistence is best-effort and ignored outside web/localStorage environments.
- Confirmed no PHI, diagnosis, prescription, payment, or EMR integration was introduced.
- Confirmed local persistence does not change role permission enforcement.

Actual artifact verification:

- `npm run typecheck` passed.
- `npx expo export --platform web --output-dir web-build` passed.
- Static preview restarted at `http://localhost:8082` after reboot.
- Browser UI verification passed: created a Viewer pending invite, reloaded the page, and confirmed the pending invite remained visible.
- Browser UI verification passed: Settings shows the local-device-only persistence notice in English and Chinese.
- Browser UI verification passed: no raw permission IDs are exposed in the UI.
- Visual screenshots reviewed: `docs/qa-local-persistence-en.png` and `docs/qa-local-persistence-zh.png`.

### Stage: handoff acceptance closure

Original requirement match:

- Closed the task handoff loop after a handoff request is created.
- Added target-member actions to accept or decline a pending handoff inside the same app.
- Kept handoff acceptance role-gated: only members with task claim permission can accept, and the action is shown only to the requested target member.
- Kept the simplified 3-role model: Coordinator, Caregiver, and Viewer.
- Kept default English UI and localized the new handoff actions in Chinese and Spanish.

Independent quality review:

- Confirmed accepting a handoff reuses the existing audited task claim path, changes the task back to `claimed`, assigns the target member as owner, and clears `handoffToId`.
- Confirmed declining a handoff reuses the existing audited task reject path and returns the task to the claimable pool.
- Confirmed non-target members do not see the accept/decline handoff actions.
- Confirmed Viewer role remains excluded from task access and handoff candidates.
- Confirmed no PHI storage, diagnosis, prescription, payment, or EMR workflow was introduced.

Actual artifact verification:

- Browser UI verification passed after reboot: Eli saw `Accept handoff` / `Decline handoff` for a task handed off to Eli.
- Browser UI verification passed: accepting the handoff changed the task from `Handoff Requested` to `Claimed`, owner changed to Eli Chen, and the accept/decline actions disappeared.
- Browser UI verification passed: Coordinator Recent audit showed the original handoff request and subsequent `Task claimed` acceptance event.
- Browser UI verification passed: Chinese target-member view showed `接受交接` and `拒绝交接` for a task handed off to Sam Rivera.
- Visual screenshots reviewed: `docs/qa-handoff-accept-final-en.png` and `docs/qa-handoff-accept-zh.png`.

### Stage: simplified Home next actions

Original requirement match:

- Reduced user learning cost by making Home show the current role's next best actions before the deeper module sections.
- Kept all quick actions inside the same app; no separate admin page or web backend console was introduced.
- Reused existing role permissions and domain actions for accept handoff, claim task, complete task, open files, open timeline, and generate report.
- Kept default English UI and added Chinese and Spanish translations for the new Home action copy.
- Preserved the non-PHI MVP boundary and did not add diagnosis, prescription, payment, or EMR workflows.

Independent quality review:

- Confirmed Home actions are computed from actual task/document state and the active member's role permissions.
- Confirmed Caregiver handoff acceptance from Home updates the underlying task state instead of creating a separate shortcut-only state.
- Confirmed Viewer fallback shows only a timeline viewing action and does not reveal Tasks or Docs tabs.
- Confirmed long labels can wrap inside compact action rows without requiring users to learn hidden controls.
- Confirmed legacy English role values stored in local role notifications are re-localized at render time.

Actual artifact verification:

- `npm run typecheck` passed.
- `npx expo install --check` passed.
- `npx expo export --platform web --output-dir web-build` passed.
- Browser UI verification passed: default English Home shows `Next actions`, a claim action, file review shortcut, and timeline shortcut.
- Browser UI verification passed: Chinese Sam Home showed `下一步` with `接受交接`; tapping it changed the next action to `完成你的任务`.
- Browser UI verification passed: Chinese Viewer Home showed only the timeline next action and bottom tabs `首页 / 时间线 / 设置`; Tasks and Docs were hidden.
- Browser UI verification passed: Chinese role notification text no longer mixed in the legacy `Viewer` role label.
- Visual screenshots reviewed: `docs/qa-home-next-actions-en.png`, `docs/qa-home-next-actions-zh.png`, `docs/qa-home-next-actions-zh-accepted.png`, and `docs/qa-home-next-actions-viewer-zh-localized.png`.

### Stage: 2026-07-23 project-lead independent re-audit, compile-fix, and smoke test

Context: A prior `AUDIT_REPORT.md` (2026-07-22) listed 3 P0 + several P1/P2 defects. This stage is an independent re-audit against the **current** source, not a replay of the prior report.

Independent source re-verification (current `src/`):

- P0 #1 invite-name i18n: **FIXED**. `inviteMember` now stores a language-neutral English sentinel (`"New caregiver invite"` / `"New viewer invite"`); both `domain.memberName` and `App.memberDisplayName` derive the pending-member display from `member.role` + `inviteStatus` via `t("member.invitedCaregiver")` / `t("member.invitedViewer")`, so display follows the active language. Verified `member.invitedCaregiver` exists in all three locales (en/zh/es).
- P0 #2 entity ID collision: **FIXED**. All dynamic IDs route through `uniqueId(prefix)` = `${prefix}-${Date.now()}-${Math.round(Math.random()*1e6).toString(36)}` (task/event/doc/member/audit/note/report).
- P0 #3 handoff candidates include pending invites: **FIXED**. `handoffCandidates` filters `member.inviteStatus !== "pending"`.
- P1 #4 empty persisted members crash: **FIXED**. `normalizePersistedAppState` requires `value.members.length > 0` else falls back to `initialState.members`; `actor` memo adds `?? initialState.members[0]`.
- P1 #7 upload validation order: **FIXED**. Both `onPickDocument` and `onAddSampleDocument` now use permission -> safety order.
- P1 #5 `renderReport`/`renderAudit` dead code: **STILL PRESENT**. `tabs` has 5 entries (home/tasks/timeline/documents/settings); no `activeTab === "report"|"audit"` branch; both functions defined but never called. Full audit trail only reachable as Settings 4-row compact list.
- P1 #6 `domain.generateWeeklyReport` dead code: **STILL PRESENT**. Not imported in `App.tsx`; `generateLocalizedWeeklyReport` is the live path.
- P1 #8 weekly-report text drifts with state: **STILL PRESENT** (MVP-acceptable per prior audit). `useEffect` rebuilds report text on every `state` change while audit is written once at generation.
- P2 #9 no independent git: **STILL PRESENT**. `git rev-parse --show-toplevel` resolves to `/Users/jun` (home), not the project.
- P2 #10 no automated tests: **STILL PRESENT**. No jest/vitest/playwright in `node_modules`.
- P2 #11 no ESLint/Prettier: **STILL PRESENT**.
- P2 #12 invite expiry not enforced: **STILL PRESENT**. `inviteExpiresAt` only displayed (`home.inviteCopy`), never compared to current time.
- P2 #13 a11y label hardcoded English: **STILL PRESENT**. `accessibilityLabel={... \`Act as ${memberDisplayName(member, t)}\`}`at`App.tsx:370`.

New P0 regression found and fixed this stage:

- `src/domain.ts` `memberName` was missing its closing brace; `return member.name;` was immediately followed by `export function formatDateTime`, producing `error TS1005: '}' expected` at `domain.ts(644,1)`. The project did **not** compile, invalidating the 07-22 "typecheck passed" QA note for the current tree. Root cause: an in-progress edit for the P0 #1 i18n fix left the function unclosed. Fix applied: added the closing `}`.

Actual artifact verification after fix:

- `npx tsc --noEmit`: **0 errors** (was failing before fix).
- `npx expo export --platform web --output-dir web-build`: **passed**, bundle `_expo/static/js/web/index-...js` = 984KB, `index.html` + `metadata.json` emitted.
- Static build served at `http://127.0.0.1:8082/` (python `http.server`), HTTP 200.
- Headless Chrome (`--headless=new`) render smoke test: DOM dump 24,767 bytes; rendered text contains `RelayCare`, `Non-PHI family coordination MVP`, care circle with all four members and roles (Maya/coordinator, Eli/caregiver, Sam/caregiver, Aunt Lee/viewer), non-PHI boundary copy, metrics (`3 Open tasks`, `0 Completed`, `33% Owner rate`, `1 Critical open`), `Next actions`, and `Claim open task: Arrange transport for follow-up appointment`. Desktop 1280x900 and mobile 390x844 screenshots captured to `/tmp/relaycare-qa/`.
- i18n key presence check: all newly referenced keys (`audit.detail.report.generated`, `notification.title.reportGenerated`, `notification.body.reportGenerated`, `home.actionAcceptHandoff`, `home.nextActions`, `member.invitedCaregiver/invitedViewer`, `tasks.acceptHandoff/declineHandoff`, `handoff.title/empty`) exist; sample key verified across en/zh/es.
- Static server stopped after testing.

Open items requiring project-lead decision (presented separately to user): P1 #5/#6 dead-code + audit-page strategy, P2 #9/#10/#11 engineering baseline, P2 #12/#13/#8 minor fixes.

## 2026-07-23

### Stage: A2 + B3 + C1 completion, lint hardening, first commit, full verification

Context: User approved A2 + B3 + C1 and added delivery constraints: no web deliverable (app-only), all settings in-app, role-differentiated UI. This stage completes all three workstreams and verifies the final artifact.

Original requirement match:

- A2 (audit page reachable + dead-code removal): `renderReport` and `domain.generateWeeklyReport` dead code removed (grep-confirmed no residue); `TabKey` no longer contains `"report"`; `renderAudit` is reachable from Settings via `settings.viewAllAudit` entry, gated to `audit:read` (coordinator only), with a localized back button (`audit.back`).
- B3 (engineering baseline): independent git repo initialized with first commit `469ff27` (toplevel = relaycare-mvp, decoupled from `~/` home git); vitest + `src/__tests__/domain.test.ts` (17 tests covering permissions/claim/handoff/audit/invite-expiry/ID-uniqueness); ESLint flat config + Prettier; npm scripts for typecheck/lint/test/format.
- C1 (minor fixes): P2#13 a11y `Act as` hardcoded -> `t("member.actAs", {name})`; P2#12 invite expiry enforced via `domain.isHouseholdInviteExpired` + `onInviteMember` interception + Settings notice; P1#8 weekly report snapshot per language `reportText: Record<Language,string>` with the state-driven rebuild useEffect removed.
- Delivery constraints honored: deliverable is RN app (iOS/Android); `web-build/` is gitignored and not delivered; `expo export --platform web` used only as headless build smoke; all settings in-app (Settings tab); role-differentiated UI via `canAccessTab` (coordinator sees audit entry, caregiver does not, viewer sees only home/timeline/settings).

Independent quality review:

- Confirmed dead-code removal by grep: no `generateWeeklyReport`, no `renderReport` in `src/`.
- Confirmed audit page is coordinator-only: entry uses `can("audit:read")` and `activeTab === "audit" && can("audit:read")` guards the render.
- Confirmed i18n keys exist in all three locales: `member.actAs`, `alerts.inviteExpiredTitle/Body`, `settings.inviteExpiredNotice`, `settings.viewAllAudit`, `audit.back` (en/zh/es verified).
- Confirmed invite expiry uses a pure function `isHouseholdInviteExpired(state, now)` and is invoked in both `onInviteMember` and Settings rendering.
- Confirmed weekly report stores a trilingual snapshot at generation time and no longer rebuilds on every state change.
- Confirmed git identity is set (Billy / Billy.yu@me.com) and no node_modules/web-build/.expo/.env staged in the first commit.
- Confirmed lint fixes are behavior-preserving: hydration moved to lazy `useState(() => loadPersistedAppState())` (eliminates the mount effect, removes the `stateHydrated` flag); tab-guard effect kept as an effect (covers every role/tab change path) with a documented `eslint-disable-next-line`; `handoffCandidates` dependency changed to `[actor.id, state]` to satisfy exhaustive-deps while remaining correct.

Actual artifact verification:

- `npx tsc --noEmit`: 0 errors.
- `npx vitest run`: 17/17 passed.
- `npx eslint .`: 0 errors, 0 warnings.
- `npx prettier --check .`: all files pass.
- `npx expo export --platform web --output-dir web-build`: passed, bundle 987KB, `index.html` + `metadata.json` emitted.
- Headless Chrome (`--headless=new --virtual-time-budget=6000`) render smoke: DOM 24,767 bytes; rendered text contains `RelayCare`, `Non-PHI`, `coordinator`, `Maya`, `Next actions`; desktop 1280x900 screenshot captured to `/tmp/relaycare-qa/desktop.png` (91KB). Hydration lazy initializer confirmed working at runtime.
- `git log --oneline -1`: `469ff27 chore: initial commit of RelayCare MVP (A2+B3+C1 baseline)`; working tree clean.

Double self-check:

- Pass 1 (vs original requirement): A2/B3/C1 complete; no-web-deliverable, in-app settings, role-differentiated UI all satisfied; 30-min reporting mechanism decision presented to user.
- Pass 2 (independent completeness/correctness/format/risk): all checks green; i18n trilingual; git clean; residual risks recorded (web dependency retained for dev smoke pending user confirmation; reporting mechanism pending user choice; native persistence is a known MVP limitation out of scope).

Open items requiring user decision: 30-min reporting mechanism (in-session vs LaunchAgent vs Feishu bot); whether to fully remove web capability.

## 2026-07-24

### Stage: Plan C - Supabase cloud backend + sync + full UI integration

User decision: Plan C (Supabase) for "data survives phone change/app reinstall" + family multi-member sharing.

Backend (backend/supabase/migrations/):

- 0001: 9 tables (households/members/role_definitions/notification_preferences/role_notifications/tasks/care_events/documents/audit_events).
- 0002: RLS per household_id; current_household_id() helper; create_household RPC (household+coordinator+audit); accept_invite RPC; realtime publication for 7 tables.
- 0003: seed role_definitions (coordinator/caregiver/viewer).
- Tables built on user Supabase instance; role seed verified.

App data layer (src/lib/):

- supabase.ts: client via EXPO_PUBLIC_ env vars; isSupabaseConfigured flag.
- db.ts: fetchHouseholdState, subscribeHouseholdState (realtime), createHousehold/acceptInvite RPCs; DB<->App type mapping.
- actions.ts: 11 write ops via Supabase + audit + role notifications.

Auth (src/auth/):

- AuthContext: onAuthStateChange, fetchHouseholdId.
- AuthScreen (sign in/up) + OnboardingScreen (create/join household).

App integration (src/App.tsx):

- App gate: unconfigured -> LocalApp (local demo); configured -> AuthProvider + CloudApp.
- LocalApp accepts optional cloud props; 13 handlers cloud branch calls lib/actions, local branch unchanged; reuses all renderHome etc.
- CloudApp: auth gate + fetchHouseholdState + subscribeHouseholdState + renders LocalApp cloud.
- Top bar cloud sign-out; actor chips disabled in cloud (actor fixed to signed-in user); persist effect skipped in cloud.

Verification:

- tsc --noEmit: 0 errors.
- eslint .: 0 error 0 warning.
- prettier --check: all pass.
- expo export --platform web: passed.
- Headless Chrome: cloud mode renders AuthScreen (.env injected, isSupabaseConfigured=true).
- auth full chain (curl): signup -> create_household RPC -> RLS read household/members/audit_events -> anon isolation ✅.
- end-to-end multi-user (curl): A create_household -> A invite caregiver (pending member) -> B signup -> B accept_invite RPC -> B sees same household members (Coord A + self caregiver active) + household -> anon sees nothing ✅.

Supabase config note: email confirmation disabled for dev testing; re-enable + configure email before production.

Open items: runtime UI interactive verification (iOS/Android); web capability removed (decision logged 2026-07-24).

---

## 2026-07-24 — Web removal + cloud notification bug fix

Context: User approved decision 1B (OCR/AI deferred to post-pilot) and decision 2B (fix all issues + fully remove web).

Changes:

- Fixed cloud notification titleKey bug: actions.ts createTask/confirmDocumentAndCreateTask used non-existent i18n key `notification.title.taskCreated`, causing cloud push + notification list to render the raw key. Aligned with domain.ts (criticalTask/newTask).
- Unified uniqueId: domain.ts now imports from lib/id.ts (was a duplicated private impl).
- Push notification language persistence: new lib/language.ts; CloudApp push renders in user-selected language (was hardcoded en).
- Fully removed web: dropped react-dom/react-native-web top-level deps, app.json web config, web npm script, localStorage persistence dead code, showMessage web branch, README web run instructions. react-dom/react-native-web remain only as expo transitive peers (do not affect native builds).
- Docs: PROGRESS/AUDIT_REPORT/QA_Log updated.

Verification (double check after npm install):

- tsc --noEmit: 0 errors.
- vitest run: 17/17 passed.
- eslint .: 0 error 0 warning.
- prettier --check: all pass.

Open items: runtime UI interactive verification (iOS/Android simulator or device); pilot gating (email confirmation + privacy policy/ToS + device matrix QA). OCR on-device implemented 2026-07-24 (decision updated from 1B).

---

## 2026-07-24 - On-device OCR implemented (decision updated from 1B to "now")

Context: User updated decision - implement on-device OCR now (not post-pilot). Library: @dariyd/react-native-text-recognition (image + PDF + 100+ languages incl. Chinese; iOS Apple Vision + Android Google ML Kit).

Changes:

- npm install @dariyd/react-native-text-recognition (native module; requires prebuild/EAS Build, not Expo Go).
- src/lib/ocr/heuristics.ts: candidate-field extraction (date/medication/followup, trilingual regex), confidence (iOS element avg / Android heuristic), suggestedAction.
- src/lib/ocr/providers.ts: DeviceOcrProvider.extract() implemented (calls recognizeText + heuristics). No longer a stub.
- src/lib/ocr/index.ts: export ocrProviderName for UI conditional demo banner.
- App.tsx: demo banner now shows only in mock mode (ocrProviderName === "mock"); i18n documents.ocr dropped "(demo)" suffix (real OCR).
- .env.example: EXPO_PUBLIC_OCR_MODE default = device (mock is Expo Go dev fallback).
- Docs: AI_OCR_NOTICE / PROGRESS / QA_PLAN / COMPLIANCE_CHECKLIST updated to reflect implemented on-device OCR.

Verification:

- tsc --noEmit: 0 errors.
- eslint .: 0 error 0 warning.
- prettier --check: all pass.
- vitest run: 17/17 passed.
- Runtime: requires prebuild (native module); Expo Go falls back to mock. Native-build OCR verification pending prebuild.

Open items: prebuild + native-build runtime OCR verification; email confirmation (user in progress); pilot gating.

---

## 2026-07-24 - On-device OCR native build verified (BUILD SUCCEEDED)

Context: User chose plan B (local cocoapods mirror + pod install + xcodebuild) to verify the on-device OCR native integration.

Steps & results:

- expo prebuild --platform ios: success (ios/ generated, dariyd autolinked).
- pod install: success after fixing create-stub-xcframework.sh permission (chmod +x). 93 dependencies, 92 pods installed; `react-native-text-recognition iOS 13.0` in the install list (dariyd autolinked). Hermes downloaded from Maven (CDN specs reachable; RN C++ deps prebuilt).
- xcodebuild (iphonesimulator Debug): **BUILD SUCCEEDED** after `find node_modules -name '*.sh' -exec chmod +x {} +` (npm had dropped exec bits on react-native/scripts/xcode/with-environment.sh etc., same class of issue previously noted in PROGRESS).
- App artifact: RelayCareMVP.app built; dariyd compiled and linked.

Root cause of the permission failures: npm install did not preserve exec bits on some .sh scripts (node_modules/.bin, expo-modules-jsi, react-native/scripts). Fixed by chmod +x all node_modules .sh.

Verification status:

- Code: tsc/eslint/prettier/vitest all green.
- Native integration: prebuild + pod install + xcodebuild BUILD SUCCEEDED.
- Runtime OCR end-to-end (upload doc -> recognizeText -> candidate fields): pending cloud-mode login interaction (app starts at AuthScreen with Supabase configured).

Open items: runtime OCR end-to-end test (needs cloud login + doc upload); email confirmation (user in progress); pilot gating.
