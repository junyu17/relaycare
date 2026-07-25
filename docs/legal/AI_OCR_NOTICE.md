# AI / OCR Usage Notice (DRAFT)

> **Status:** Draft v0.1 — 2026-07-24. Requires review by US privacy/medical legal counsel before any real AI/OCR integration is enabled. Per project decision 1B (2026-07-24), real OCR/AI integration is deferred until after the pilot.

## 1. Current State (MVP / Pilot)

During the MVP and pilot phase:

- **OCR is demonstration-only.** The confidence values shown on documents are demo data, not the result of real OCR extraction. The app UI clearly labels this (`documents.ocrDemoNotice`).
- **AI summaries are template-based.** The weekly family report is generated from deterministic templates, not a large language model.
- **No PHI is sent to any external AI or OCR provider.**

This is intentional: the pilot's purpose is to validate that care responsibility is genuinely shared across family members, not to validate OCR or AI accuracy.

## 2. Future Design (When Real OCR/AI Is Enabled)

When real OCR/AI is introduced (post-pilot), the following safeguards apply, consistent with the project charter (§5.3):

### OCR

- Outputs only **candidate structured fields** with a **confidence score**.
- **No field is written automatically.** A user must confirm candidate fields before they become a task or record.
- The original file and source coordinates are retained for traceability.

### AI Summaries

- Restricted to a **predefined JSON schema**.
- Prompts explicitly **prohibit diagnosis, dosage, and emergency judgments**.
- Output displays **source references** and a **non-medical disclaimer**.
- Output is auditable and traceable to source events.

### Privacy and Vendors

- **No PHI is sent to external AI/OCR providers without a BAA or compliant agreement.** De-identification is used first where feasible.

### Human Control

- Automation never changes medications, appointments, or medical records automatically.
- Every AI/OCR-derived action requires a responsible person's confirmation.

## 3. Auditability

All document uploads, confirmations, AI/OCR-derived task creation, and summary generation are written to the immutable audit log (`AuditEvent`) with actor, timestamp, and entity reference.

## 4. User Control

Users can review OCR candidates and AI summaries before any action. Low-confidence fields are blocked from automatic write. Users remain the final authority on whether a candidate becomes an action.
