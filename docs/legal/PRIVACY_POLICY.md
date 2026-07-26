# Privacy Policy (DRAFT)

> **Status:** Draft v0.1 — 2026-07-24. Requires review by US privacy/medical legal counsel before any production use, public release, or institutional partnership. TaskKin Care is the current product name; legal and trademark review remain required.

## 1. Overview

TaskKin Care is a family care coordination and information-organization tool. It helps families share care tasks, timelines, documents, and notifications so that care responsibility is distributed rather than carried by one person. TaskKin Care is **not** a medical device, a medical service provider, or an emergency response service.

TaskKin Care is developed and operated by Jun Yu, an independent developer. For privacy questions or data requests, contact [Billy.yu@me.com](mailto:Billy.yu@me.com).

This policy explains what information TaskKin Care processes, how it is used, and the choices you have.

## 2. Information We Process

**Account information:** email address and authentication credentials (managed by our auth provider; we do not store plaintext passwords).

**Family and member information you enter:** household name, care recipient label, member names, relationships, roles, time zones, and availability notes you choose to provide.

**Care coordination content:** tasks, timeline events, document metadata (filename, upload time, confidence indicators), notification preferences, and audit records of who did what and when.

**Document files:** files you upload for family coordination. You are responsible for ensuring uploaded files are de-identified or do not contain Protected Health Information (PHI).

## 3. Information We Do Not Collect

By design, the MVP does **not** collect diagnoses, prescriptions, insurance data, payment data, or precise location data. This data-minimization posture is intentional.

## 4. PHI and HIPAA

The MVP is designed to operate **without** processing PHI. Whether TaskKin Care is a HIPAA-covered entity or business associate depends on the specific relationship with covered entities and the data actually processed; we do not assume HIPAA does not apply. Before any institutional partnership, PHI handling, or AI/OCR integration that involves PHI, a US privacy/medical legal counsel must confirm the compliance path (including BAA where required).

## 5. How We Use Information

- To provide the family care coordination features.
- To send role-based notifications and weekly summaries.
- To maintain an audit trail of sensitive actions (access, ownership changes, report generation).
- To improve reliability and security.

## 6. Sharing

- **Within your household:** members of your household can see household-scoped data. A household is isolated from other households at the database level.
- **We do not sell your information.**
- **Service providers:** we use infrastructure providers (see the vendor list in `COMPLIANCE_CHECKLIST.md`) that process data on our behalf under appropriate terms. No PHI is sent to external AI/OCR providers without a compliant agreement.

## 7. Storage and Security

- Data in transit is protected with TLS 1.2+.
- Data at rest is stored in encrypted databases and object storage.
- Each household's data is isolated via row-level security policies.
- Sensitive actions (document access, ownership changes, report export, AI summary generation) are recorded in an immutable audit log.
- Access follows least-privilege role-based permissions.

## 8. Retention and Deletion

You can request deletion of your household data. Deletion/audit-retention timelines and the export procedure are defined in `COMPLIANCE_CHECKLIST.md`. Audit records may be retained for a defined period for security and accountability even after content deletion.

## 9. Your Rights

You may request access to, correction of, deletion of, or export of your data by emailing [Billy.yu@me.com](mailto:Billy.yu@me.com).

## 10. Minors and Authorized Representatives

TaskKin Care is intended for use by adults or authorized representatives (e.g., a primary caregiver acting for a care recipient). Minors may be the subject of care information entered by an authorized representative, not direct account holders, in the MVP.

## 11. Cross-Border (Multi-Time-Zone Families)

Families often span multiple time zones and jurisdictions. Data is processed to support cross-member coordination; members should be aware that other household members may be in different jurisdictions.

## 12. Changes

We will notify users of material changes to this policy.

## 13. Contact

For privacy questions or data requests, email [Billy.yu@me.com](mailto:Billy.yu@me.com).
