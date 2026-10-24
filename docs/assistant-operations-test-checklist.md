# Angermund AI Operations Assistant — post-integration acceptance checklist
Created: 2026-10-24. Use **real record numbers and names** in place of placeholders. Never use production test data without intending to commit a change.

## Before testing
- Sign in as an admin / dispatcher / finance user. Note the current values of a **test-safe** trip, employee, loan and task. Choose records that may safely be edited.
- Open **✦ Ask Angermund**. Every mutating command must present an exact preview with **Approve & Save** and **Cancel**. A cancelled preview must never change data.
- Run negative tests (wrong role, duplicate number, ambiguous person, stale record) before approving any live production change.
- Test on desktop and Android, including scrolling the approval panel and returning to the updated record.

## Read-only server-grounded questions (should respond without approval)
- [ ] **Which trucks are available?** — expect real saved truck statuses and no claim of live GPS.
- [ ] **Which trips are still planned?** — expect trip, truck and driver assignments.
- [ ] **Which trips have missing POD?** — expect delivered/offloading trips only.
- [ ] **Show overdue tasks** — expect past-due Open/In progress tasks, not completed tasks.
- [ ] **What is the status of trip TRIP-NUMBER?** — expect stage, saved update time and assignments.
- [ ] **What loans does EMPLOYEE NAME have?** — finance/admin only; show balances and instalments.
- [ ] **Show pending expenses** — finance/admin only; show Review/Pending expenses.
- [ ] Ask a driver/dispatcher for private employee loan information — **must refuse**.

## Existing approval actions
- [ ] Change trip TRIP-OLD number to TRIP-NEW — preview, cancel, then approve using a designated test record; verify links persist.
- [ ] Switch truck ANG NUMBER from planned to departing — preview and approve only with an assigned driver, truck and eligible trip.
- [ ] Add loan to EMPLOYEE NAME for N$2000 monthly deduction N$200 — check Worker Loans, with **no money transfer**.
- [ ] Change EMPLOYEE NAME loan monthly deduction to N$250 — check updated rate, previous paid payslips untouched.
- [ ] Pause EMPLOYEE NAME loan / Resume EMPLOYEE NAME loan — verify future deductions honor the Paused state.
- [ ] Create task to check ANG NUMBER tomorrow, high priority — verify due date and task entry.
- [ ] Assign driver FULL NAME to trip TRIP-NUMBER — ensure no simultaneous active-trip collision.
- [ ] Assign truck ANG NUMBER to trip TRIP-NUMBER — reject occupied trucks.
- [ ] Record toll expense N$450 for trip TRIP-NUMBER — should create Review with missing receipt, not approve/pay it.

## New approval actions
- [ ] Set task "EXACT TITLE" priority to High — check task status and audit.
- [ ] Set task "EXACT TITLE" due 2026-11-02 — check date.
- [ ] Mark task "EXACT TITLE" in progress — should not falsely mark it completed.
- [ ] Assign task "EXACT TITLE" to driver FULL NAME — check actual task assignment and notification.
- [ ] Add note to trip TRIP-NUMBER: Customer requested arrival call — check appended internal note, not customer messaging.
- [ ] Set order reference for trip TRIP-NUMBER to NBL-REFERENCE — check live record and protection against import overwrite.

## Safety and reliability checks
- [ ] No command changes any record before approval.
- [ ] Cancel and expiry (10 minutes) leave all records unchanged.
- [ ] Open the same record on another device, change it, then attempt approving the old draft — expect stale-revision error.
- [ ] A role without permission cannot create loans or edit dispatch.
- [ ] Ambiguous employee, truck, trip or task names request an exact identifier; **never guess**.
- [ ] An instruction to mark a POD/proof-requiring task Completed must redirect to the task's evidence workflow.
- [ ] New expenses remain Review with receipt missing, never silently paid/approved.
- [ ] Each approved change is recorded in the audit history.
- [ ] Phone and desktop show readable preview, Cancel, Approve, and saved-record navigation.

## Future module integrations — not yet available as automated actions
- [ ] Multi-step trip creation from a complete load specification.
- [ ] Per-leg invoicing and approved invoice corrections.
- [ ] Diesel slip data correction with source slip proof.
- [ ] Driver loans, payslip adjustments and recon approvals with additional approvals.
- [ ] GPS/tracker geofence queries and verified NBL hourly partner reporting.
- [ ] Quotations from negotiated customer rates and per-km costing.
- [ ] Maintenance/service jobs, truck workshop scheduling and tyre replacements.
- [ ] Batch actions with independent preview for each proposed change.

**Rule:** A green test result means both automated tests passed *and* a person has completed the relevant acceptance test using an authorized account. GitHub Actions alone does not verify the behavior on an Android phone or with live production data.
