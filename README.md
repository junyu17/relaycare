# TaskKin Care MVP

React Native + TypeScript MVP scaffold for a non-PHI family care coordination platform.

## Scope

This implementation follows the 16-week MVP boundary from the project charter:

- Household, care circle, roles, permissions, and invite expiry.
- Task pool with claim, reject, handoff, completion proof, and audit trail.
- Care timeline with event type and member filters.
- Role-aware notification controls with quiet hours and critical task guardrails.
- Weekly family report that summarizes completed work, open work, upcoming events, and load.
- Basic document upload metadata with manual confirmation before a task is created.
- Audit log for all write actions and sensitive document actions.

The MVP intentionally excludes diagnosis, prescription, payment, insurance, emergency triage, deep EMR/EHR integration, and automatic PHI processing.

## Run

```bash
npm install
npm run typecheck
npm run ios   # or: npm run android
```
