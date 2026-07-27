# Compliance Checklist & Operational SOPs (DRAFT)

> **Status:** Internal working document. Effective: July 26, 2026. Requires sign-off by product lead, tech lead, and US privacy/medical legal counsel before pilot launch.

This checklist tracks the pre-launch compliance items required by the project charter (§6). Items marked ✅ are drafted; items marked ⏳ require action.

## 1. Required Documents

| Document                                    | Status                                                              | Path                                |
| ------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| Privacy Policy                              | ✅ Drafted (needs legal review)                                     | `docs/legal/PRIVACY_POLICY.md`      |
| Terms of Service                            | ✅ Drafted (needs legal review)                                     | `docs/legal/TERMS_OF_SERVICE.md`    |
| Clinical Disclaimer & Emergency Guidance    | ✅ Drafted (needs clinical + legal review)                          | `docs/legal/CLINICAL_DISCLAIMER.md` |
| AI/OCR Usage Notice                         | ✅ Drafted (needs legal review)                                     | `docs/legal/AI_OCR_NOTICE.md`       |
| Data Map                                    | ✅ Below (§2)                                                       | —                                   |
| Vendor Data Processing List                 | ✅ Below (§3)                                                       | —                                   |
| Information Security Policy                 | ✅ Below (§4)                                                       | —                                   |
| Incident Response SOP                       | ⏳ Framework below (§5) — finalize before launch                    | —                                   |
| Data Deletion / Export SOP                  | ⏳ Framework below (§6) — finalize before launch                    | —                                   |
| In-app consent + minor/representative rules | ✅ Implemented (ConsentGate on first launch + Settings legal links) | `src/legal/`                        |

## 2. Data Map

| Data object                                  | Stored where                                                      | Retention                                                       |
| -------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| Account (email, auth)                        | Supabase Auth                                                     | Until account deletion                                          |
| Household, members, roles                    | Supabase Postgres `households`/`members`/`role_definitions`       | Until household deletion                                        |
| Tasks, care events                           | Supabase Postgres `tasks`/`care_events`                           | Until household deletion                                        |
| Document metadata                            | Supabase Postgres `documents`                                     | Until household deletion                                        |
| Document files                               | Supabase Storage (`documents` bucket, private)                    | Until household deletion                                        |
| Notification preferences, role notifications | Supabase Postgres `notification_preferences`/`role_notifications` | Until household deletion                                        |
| Audit events                                 | Supabase Postgres `audit_events` (append-only)                    | Retained for security/accountability per policy (define period) |
| Local language preference                    | Device AsyncStorage (cloud mode)                                  | Until app uninstall                                             |

**MVP does not store:** diagnoses, prescriptions, insurance, payment, precise location, PHI.

## 3. Vendor Data Processing List

| Vendor                                           | Service                           | Data processed                                            | Agreement needed                |
| ------------------------------------------------ | --------------------------------- | --------------------------------------------------------- | ------------------------------- |
| Supabase                                         | Postgres, Auth, Realtime, Storage | All app data (household-scoped, non-PHI)                  | DPA; BAA only if PHI introduced |
| Expo / EAS                                       | Build & OTA updates               | App bundle, update metadata                               | Expo terms                      |
| Apple APNs / Google FCM (via expo-notifications) | Push notifications                | Notification title/body (i18n key-rendered), device token | Provider terms                  |

**No external AI/OCR vendor** - on-device OCR runs locally (no data leaves the device), so no vendor processes content. Cloud OCR (if enabled later) and any LLM vendor require BAA + legal review before integration.

## 4. Information Security Policy (Baseline)

- **Transport:** TLS 1.2+ for all connections.
- **Storage:** Encrypted database and object storage (provider-managed).
- **Isolation:** Row-level security policies enforce household boundaries; a user can never read another household's data.
- **Access control:** Least-privilege role-based permissions (coordinator / caregiver / viewer) enforced in-app; sensitive operations audited.
- **Auth:** Email/password via Supabase Auth. **Pre-launch: enable email confirmation** (currently disabled for dev) and configure MFA option.
- **Audit:** Immutable audit log for all write actions and sensitive document/report/AI actions.
- **Secrets:** `EXPO_PUBLIC_SUPABASE_*` via environment; service-role keys never shipped to the client.
- **Dependency hygiene:** `npm audit` + Semgrep SAST in CI (informational until Expo upgrade clears known transitive vulns).

## 5. Incident Response SOP (Framework — finalize before launch)

1. **Detect:** monitoring/alerting on auth anomalies, RLS violations, audit-log spikes.
2. **Contain:** revoke/suspend affected sessions; rotate compromised keys.
3. **Assess:** scope via audit log + provider logs; determine if PHI involved (triggers HIPAA path if applicable).
4. **Notify:** affected users and, where legally required, regulators — per counsel-defined timeline.
5. **Remediate:** patch, restore from backup, postmortem.
6. **Document:** incident record retained per policy.

⏳ Assign incident-response owner; define notification timelines with counsel.

## 6. Data Deletion / Export SOP (Framework — finalize before launch)

- **Export:** user can request an export of their household data (JSON of all household-scoped tables + document files). ⏳ Implement export endpoint/command before launch.
- **Deletion:** user can request household deletion; cascade deletes household-scoped data per FK `on delete cascade`. Audit events retained per §4 retention policy (define period).
- **Verification:** confirm deletion via audit log entry.

⏳ Finalize retention period for audit events with counsel; implement self-service delete/export or documented manual SOP.

## 7. HIPAA / BAA Path

- **Current (MVP/pilot, non-PHI):** HIPAA BAA not required. Counsel must confirm non-applicability given actual data processed.
- **Future (PHI or institutional partnership):** separate approval required; BAA with Supabase and any AI/OCR vendor; HIPAA-compliant configuration; state privacy law review.

## 8. Accessibility

Per charter (§6.2), the app supports Dynamic Type / font scaling (`allowFontScaling`), screen-reader labels (`accessibilityLabel`/`accessibilityRole`), sufficient touch targets, and trilingual UI (EN/中文/ES). ⏳ Verify with device-matrix QA before launch.

## 9. Pre-Launch Sign-off

- [ ] Legal review of Privacy Policy, ToS, Clinical Disclaimer, AI/OCR Notice.
- [x] Email confirmation enabled + email configured. (Operator-verified 2026-07-26.)
- [ ] Incident response owner assigned; SOP finalized.
- [ ] Deletion/export SOP finalized (retention period + self-service or manual flow).
- [ ] Device-matrix QA passed (iOS + Android).
- [ ] Dependency audit: high+ vulnerabilities resolved or accepted with rationale.
- [x] In-app consent / ToS acceptance flow implemented. (ConsentGate + Settings legal links; pending legal counsel sign-off on policy text.)
