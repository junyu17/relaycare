# AI / OCR Usage Notice (DRAFT)

> **Status:** Draft v0.1 — 2026-07-24. Requires review by US privacy/medical legal counsel before any real AI/OCR integration is enabled. Per project decision 1B (2026-07-24), real OCR/AI integration is deferred until after the pilot.

## 1. Current State (MVP / Pilot)

During the MVP and pilot phase:

- **OCR is demonstration-only.** The confidence values shown on documents are demo data, not the result of real OCR extraction. The app UI clearly labels this (`documents.ocrDemoNotice`).
- **AI summaries are template-based.** The weekly family report is generated from deterministic templates, not a large language model.
- **No PHI is sent to any external AI or OCR provider.**

This is intentional: the pilot's purpose is to validate that care responsibility is genuinely shared across family members, not to validate OCR or AI accuracy.

**Architecture is pre-wired for real OCR.** `src/lib/ocr/` defines an `OcrProvider` interface with three implementations: `MockOcrProvider` (current), `DeviceOcrProvider` (on-device, post-pilot), and `CloudOcrProvider` (cloud fallback, requires BAA). Switching is a single env var (`EXPO_PUBLIC_OCR_MODE`); the caller (`actions.addDocument`) needs no changes.

## 2. Future Design (When Real OCR/AI Is Enabled)

When real OCR/AI is introduced (post-pilot), the following safeguards apply, consistent with the project charter (§5.3):

### OCR

- **Primary (post-pilot, decision A): on-device.** iOS Apple Vision framework + Android Google ML Kit Text Recognition v2, via `@zhanziyang/expo-text-extractor` (supports Chinese/Japanese/Korean, matching the app's trilingual UI). Data never leaves the device -> no PHI compliance risk, no BAA required, works offline (meets charter §5.3 and resilience requirements).
- **Fallback (complex documents only): cloud.** AWS Textract AnalyzeDocument (Forms/Tables) or Google Document AI, invoked via a Supabase Edge Function (server-side signed, anon key never exposed). Requires a signed BAA before any PHI-capable document is processed.
- Outputs only **candidate structured fields** with a **field-level confidence score**; production accuracy on real documents typically runs 80-95% (below curated benchmarks), so human confirmation remains mandatory.
- **No field is written automatically.** A user must confirm candidate fields before they become a task or record.
- The original file and source coordinates (bounding boxes) are retained for traceability.

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

## 5. Technology Roadmap & Cost (Decision A, 2026-07-24)

**Decision:** Start with on-device OCR (Plan A); keep cloud fallback pre-wired but deferred until real data shows on-device is insufficient.

| Phase                                  | OCR approach                                     | Operating cost           | Dev cost                               |
| -------------------------------------- | ------------------------------------------------ | ------------------------ | -------------------------------------- |
| Pilot (10 families, decision 1B)       | on-device (mock until wired)                     | ~$0/month                | ~1-2 weeks to wire `DeviceOcrProvider` |
| Post-pilot scale                       | on-device primary + cloud fallback (<5% of docs) | <$10/month               | included                               |
| At scale (thousands of families)       | hybrid, cloud share rises                        | $50-200/month (per-page) | tune confidence thresholds             |
| AI summaries (LLM, independent of OCR) | OpenAI/Anthropic + JSON Schema + BAA             | ~$0.01-0.05/summary      | 1-2 weeks                              |

**Why on-device first:**

1. ~$0 operating cost during the pilot - validates the "responsibility is shared" hypothesis without burning budget on OCR accuracy.
2. No PHI compliance burden - data stays on device, satisfying charter §5.3 ("no PHI to external AI without BAA") without any legal negotiation.
3. Offline-capable - meets the charter's resilience requirement.
4. Trilingual support - ML Kit/Vision cover EN/中文/ES.

**Cloud fallback triggers (revisit after pilot):**

- Dense tables / forms (e.g., insurance EOB, multi-page discharge summaries).
- Illegible handwriting.
- On-device confidence below threshold on >X% of a family's documents.

**Cloud fallback prerequisites (do before enabling `EXPO_PUBLIC_OCR_MODE=cloud`):**

- Signed BAA with AWS or Google.
- Supabase Edge Function deployed (server-side OCR call, no client-side credentials).
- Counsel sign-off on the data flow and retention.
