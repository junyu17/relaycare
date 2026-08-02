# Task + Timeline Custom Entry Spec

Date: 2026-07-31

This is an implementation handoff spec for TaskKin Care. The goal is to make task creation more flexible while keeping timeline updates simple, non-PHI, and clearly separated from actionable work.

## Product Decision

Add two new entry points:

1. `+ Custom task` under the existing three task templates.
2. `+ Other update` under the existing three timeline templates.

Tasks and timeline events must remain conceptually separate:

- A task is actionable work: what needs to be done, by when, how urgent it is, and what state it is in.
- A timeline event is a family coordination record: what happened or is planned, when it happened or will happen, and who recorded it.

Timeline creation may optionally create a related task, but a timeline event itself is not a task.

## Existing Context

Current task templates:

- Ride to appointment
- Paperwork call
- Supply pickup

Current timeline templates:

- Check-in note
- Pickup plan
- Paperwork reminder

Relevant code areas:

- `src/App.tsx`
- `src/domain.ts`
- `src/lib/actions.ts`
- `src/types.ts`
- `src/i18n.ts`
- `backend/supabase/migrations/0006_task_activity_rpc.sql`

Do not change subscription, IAP, App Store upload, or dSYM code while implementing this feature.

## Custom Task

### Entry Point

In the Tasks tab, below the existing three template buttons, add a button:

- English: `Custom task`
- Chinese: `自定义任务`
- Spanish: `Tarea personalizada`

The button should open a modal or sheet.

### Fields

Include only these fields:

- Title: required text.
- Due date/time: required.
- Expected minutes: required numeric input or stepper.
- Priority: segmented control with `Normal` and `Critical`.

Do not include:

- Owner selection.
- Subtasks.
- Free-form medical details.

Reasoning:

- Owner should be assigned by existing workflow: create first, then a member can claim it, or a coordinator can later assign/drive handoff behavior.
- Subtasks are confusing at this stage and should not block task creation.

### Defaults

Use conservative defaults:

- Due date/time: tomorrow at 6:00 PM local time, or the nearest simple future default already used in the app.
- Expected minutes: `15`.
- Priority: `normal`.

### Creation Behavior

On submit:

- Create a task with `status = open`.
- `ownerId` should be empty.
- `requestedById` should be the actor creating the task.
- `subtasks` should be an empty array.
- Cloud mode should use the same task RPC path as existing template tasks.
- Local mode should use the same domain path as existing template tasks.

The created task should immediately appear in the claimable task list.

### Validation

Block submit and show an inline or alert error when:

- Title is empty.
- Due date/time is invalid or in the past.
- Expected minutes is not a positive number.

Keep validation messages localized.

### Permissions

Only users with `task:create` can see and use Custom task.

Current role implication:

- Coordinator: yes.
- Caregiver: yes.
- Viewer: no.

## Other Timeline Update

### Entry Point

In the Timeline tab, below the existing three quick timeline templates, add a button:

- English: `Other update`
- Chinese: `其他更新`
- Spanish: `Otra actualización`

The button should open a modal or sheet.

### Fields

Include:

- Type: required segmented/menu selection from existing `EventType` values:
  - appointment
  - transport
  - visit
  - reminder
  - document
- Time: required date/time.
- Title: required short text.
- Related member: optional; default to current actor.
- Create related task: optional toggle.

Do not include a large notes textarea in this iteration.

Reasoning:

- Timeline must stay non-PHI and coordination-oriented.
- Free-form notes increase the chance that users enter diagnosis, medication, or clinical details.

### Create Related Task

If `Create related task` is off:

- Create only the timeline event.

If `Create related task` is on:

- After the timeline event is created, create a related task.
- The task should use the timeline title as a base, but should be editable before submission if a modal flow supports it.
- Minimum task fields:
  - Title
  - Due date/time
  - Expected minutes
  - Priority
- No owner selection.
- No subtasks.
- The task should link back to the new timeline event via `eventId` where supported.

Preferred UX:

1. User fills timeline update.
2. User turns on `Create related task`.
3. The same sheet expands a small task section with task title/due/expected minutes/priority.
4. Submit creates timeline event and task.

If atomic creation is not simple in cloud mode, do this carefully:

- Create timeline event first.
- Create task second with `eventId`.
- If task creation fails, show a clear error that the timeline was saved but the task was not created.
- Do not silently fail.

Future improvement: add an RPC that creates timeline event + related task + audit + notifications atomically.

### Defaults

Timeline defaults:

- Type: `reminder`.
- Time: now.
- Related member: current actor.

Related task defaults:

- Title: same as timeline title.
- Due date/time: 24 hours after timeline time.
- Expected minutes: `15`.
- Priority: `normal`.

### Permissions

Only users with `timeline:add` can see and use Other update.

Current role implication:

- Coordinator: yes.
- Caregiver: yes.
- Viewer: no.

If `Create related task` is enabled, user must also have `task:create`.

If user has `timeline:add` but not `task:create`, hide or disable the related task toggle.

## Real Family Care Example

Scenario: a family is coordinating care after a parent returns home.

Timeline events:

- `Arrived home after discharge`, type `visit`, time Monday 3:00 PM.
- `Follow-up appointment`, type `appointment`, time Tuesday 10:30 AM.
- `Clinic requested paperwork`, type `document`, time Wednesday morning.

Tasks:

- `Arrange ride to follow-up appointment`, due Monday evening, critical.
- `Confirm what paperwork is needed`, due Tuesday morning, normal.
- `Pick up care supplies`, due Wednesday afternoon, normal.

The timeline tells the family what happened or is planned. The tasks tell the family who needs to act.

## UI Copy Guidance

Avoid explanatory paragraphs in the main UI. Use concise labels.

Suggested helper copy inside modals only:

- Task modal: `Create a claimable action for the family.`
- Timeline modal: `Record a non-medical coordination update.`
- Related task toggle: `Also create a task from this update`

Chinese:

- Task modal: `创建一个可认领的家庭协同行动。`
- Timeline modal: `记录一条不含医疗细节的协同更新。`
- Related task toggle: `同时从此更新创建任务`

## Data + Audit Expectations

Task creation should preserve existing behavior:

- Adds task.
- Adds audit event `task.created`.
- Adds role notification to caregivers.
- Critical task notification should have critical severity.

Timeline creation should preserve existing behavior:

- Adds care event.
- Adds audit event `timeline.event_added`.
- Adds coordinator notification.

Timeline + related task should result in:

- One timeline event.
- One task linked to the timeline event when possible.
- Audit/notification entries for both actions.

## Acceptance Criteria

Implementation is acceptable when all are true:

- Custom task button appears only for Coordinator/Caregiver, not Viewer.
- Custom task can create a valid open unassigned task.
- Custom task requires title, valid future due date, and positive expected minutes.
- Custom task does not ask for owner.
- Custom task does not ask for subtasks.
- Other update button appears only for Coordinator/Caregiver, not Viewer.
- Other update can create timeline events for all supported event types.
- Other update does not include a large notes field.
- Other update can optionally create a related task.
- Related task has no owner selection and no subtasks.
- Viewer can still read timeline but cannot create tasks or timeline events.
- Cloud mode and local mode both work.
- Existing three task templates still work.
- Existing three timeline templates still work.
- Existing delete task and delete timeline behavior still works.
- `npm run lint` passes.
- `npx tsc --noEmit` passes.

## Manual QA Checklist

Run through at least these roles:

1. Coordinator
   - Create custom task.
   - Create other timeline update.
   - Create other timeline update with related task.
   - Delete the created task and timeline update.

2. Caregiver
   - Create custom task.
   - Create other timeline update.
   - Create other timeline update with related task.
   - Claim the created task.

3. Viewer
   - Confirm Tasks tab remains hidden.
   - Confirm timeline creation controls are hidden.
   - Confirm timeline reading still works.

Cloud mode:

- Confirm Realtime refresh updates the task/timeline lists.
- Confirm no write fails silently.

## Review Notes For Codex

When this is implemented by another coding agent, Codex should verify broadly:

- Inspect all changed files before testing.
- Confirm no unrelated IAP, signing, dSYM, Supabase migration, or legal-page changes were introduced.
- Run lint and type check.
- Test local behavior by code inspection or app run when feasible.
- Re-check role visibility for Coordinator/Caregiver/Viewer.
- Re-check that the feature remains non-PHI and does not add free-form clinical notes.
