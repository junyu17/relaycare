# AI / OCR Usage Notice

> **Effective:** July 26, 2026
> **Status:** Operator-reviewed product notice. Independent privacy/medical legal counsel review has not been obtained. On-device OCR is implemented and is the production default; AI summaries remain template-based.

## 1. Current State (MVP / Pilot)

During the MVP and pilot phase:

- **On-device OCR is implemented.** Document uploads run real text recognition on-device via `@dariyd/react-native-text-recognition` (iOS Apple Vision + Android Google ML Kit; supports images, PDFs, and 100+ languages including Chinese). Data never leaves the device. The "demo" notice is shown only when running in mock mode (e.g., Expo Go development without a native build).
- **AI summaries are template-based.** The weekly family report is generated from deterministic templates, not a large language model. LLM summaries remain a future enhancement.
- **No PHI is sent to any external AI or OCR provider.**

The pilot's purpose remains to validate that care responsibility is genuinely shared across family members; OCR accuracy is a means, not the goal.

**Architecture.** `src/lib/ocr/` defines an `OcrProvider` interface with three implementations: `MockOcrProvider` (Expo Go dev fallback), `DeviceOcrProvider` (on-device, current production default), and `CloudOcrProvider` (cloud fallback, requires BAA). The active provider is selected by `EXPO_PUBLIC_OCR_MODE` (default `device`); the caller (`actions.addDocument`) needs no changes when switching.

## 2. Design & Safeguards

The following safeguards apply to all OCR/AI processing, consistent with the project charter (§5.3):

### OCR

- **Primary (implemented, decision A): on-device.** iOS Apple Vision framework + Android Google ML Kit Text Recognition v2, via `@dariyd/react-native-text-recognition` (supports images + PDFs + 100+ languages including Chinese/Japanese/Korean, matching the app's trilingual UI). Data never leaves the device -> no PHI compliance risk, no BAA required, works offline (meets charter §5.3 and resilience requirements). Requires a native build (prebuild/EAS Build; not loadable in Expo Go).
- **Fallback (complex documents only): cloud.** AWS Textract AnalyzeDocument (Forms/Tables) or Google Document AI, invoked via a Supabase Edge Function (server-side signed, anon key never exposed). Requires a signed BAA before any PHI-capable document is processed.
- Outputs only **candidate structured fields** with a **field-level confidence score**; production accuracy on real documents typically runs 80-95% (below curated benchmarks), so human confirmation remains mandatory.
- **No field is written automatically.** A user must confirm candidate fields before they become a task or record.
- The original file is retained in private object storage for traceability. On-device OCR computes candidate fields, confidence, and a suggested action; only the overall confidence and suggested action are persisted to document metadata. The raw extracted text and bounding boxes are processed ephemerally on the device and are **not** stored server-side, so no PHI leaves the device.

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

**Decision (updated 2026-07-24):** On-device OCR is implemented now (Plan A). Cloud fallback remains pre-wired but deferred until real pilot data shows on-device is insufficient.

| Phase                                  | OCR approach                                     | Operating cost           | Dev cost                   |
| -------------------------------------- | ------------------------------------------------ | ------------------------ | -------------------------- |
| Pilot (10 families)                    | on-device (implemented)                          | ~$0/month                | done                       |
| Post-pilot scale                       | on-device primary + cloud fallback (<5% of docs) | <$10/month               | included                   |
| At scale (thousands of families)       | hybrid, cloud share rises                        | $50-200/month (per-page) | tune confidence thresholds |
| AI summaries (LLM, independent of OCR) | OpenAI/Anthropic + JSON Schema + BAA             | ~$0.01-0.05/summary      | 1-2 weeks                  |

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
