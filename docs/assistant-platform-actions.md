# Chat operations assistant

The assistant prepares one change at a time. The server resolves exact references against current saved records, checks the account's role and displays a preview. Approve & save executes the whitelisted operation. No model-generated code or arbitrary API call is executed.

## Working coverage

- Existing operations: employee loans, deductions, task creation and updates, trip numbers and departure, driver/truck assignments, trip notes and order references.
- Purchases: capture parts, repairs, tyres and other expenses for a truck or trip, with or without a slip. These remain Review or Receipt missing, not automatically approved spending.
- Diesel: capture litres, total/price, date, supplier, odometer and reference, optionally reading an attached receipt through the existing receipt scanner.
- POD: attach an image/PDF to a trip, specifying a load when there are multiple legs. A POD does not verify depot arrival.
- Slips: move an already posted diesel/expense slip to a named truck or single-load trip. Receipt references must uniquely identify a posted record. Unposted driver uploads continue through their existing recovery workflow.
- Invoices: single journey-leg invoice, NBL consolidated cycle/custom-date invoices, NBL monthly shunter invoices. All use existing billing helpers, VAT, MDC and payment protections. The preview runs those helpers on a copy before approval.
- Quotations: save a single-route quotation with the existing costing engine and saved operating-cost defaults. Show cost assumptions, recommended amount and proposed selling amount for review. Actual journey distance must include any empty travel. Cross-border routes require known Namibia km.
- Trips and workshop: create a planned trip with explicit client, route, truck, driver, date and income; create an open maintenance work order.
- Edit supported fields on existing quotes, invoices, trips, diesel, expenses, overheads, maintenance, tyres, inspections, incidents, advances, payments, trip issues, shunter recons and loan notes/references. Multi-load trip edits require legId. Payroll uses its dedicated workflow.
- Delete a single supported transactional record through the existing record manager, including archival history and linked-record/payment protections. Master records and accounts are outside this generic delete workflow.
- Read current records with Show/Find/List/Search and a supported record type. Tender information summarizes saved quote costing. The assistant does not submit external tenders or invent tender requirements.

Broad phrasing requires server `OPENAI_API_KEY`; `SITE_ASSISTANT_MODEL` retains the existing configuration. Explicit templates work without AI. The server's capability catalog restricts available operations by role. Missing fields cause clarification, not guessed records. An unfinished request can accept a date-only follow-up for ten minutes; broader clarifications use AI. Files remain temporary until approved, expire with the draft and save in the same PostgreSQL transaction as their linked records.

## Try after deployment

Use real references and dates from your data; test in a safe environment before deleting real records.

1. Ask `What can you do?` as admin and as driver. Drivers must not receive financial operations.
2. `I bought parts for truck ANG 12 on 2026-10-24 for N$1200`. Review truck/date/category/amount, cancel and verify no record. Repeat and approve; check Expenses, truck link and Receipt missing status.
3. Attach a slip with the same request; check extracted values and filename. Approve and open the receipt. Repeat a known supplier receipt reference; it should reject a duplicate.
4. `Record diesel 100 litres total N$2700 for truck ANG 12 on 2026-10-24 odometer 123456`. Verify cost N$2700, price N$27/L and no fabricated proof.
5. `Assign slip PART-77 to truck ANG 12` or `Assign slip PART-77 to trip AT-101`. Confirm the old/new trip costs refresh and proof remains accessible.
6. Attach a POD: `Attach POD to trip AT-101 leg 1`. Check the selected load, actual document and delivery state. Depot completion must not be inferred from the upload.
7. `Create invoice for trip AT-101 leg 1`. Missing billing evidence/MDC must be explained before a preview. Approve a valid preview; reopen the invoice and check VAT/MDC.
8. `Generate NBL consolidated invoice for 2026-10` and `Generate NBL shunter invoice for 2026-10`. Verify period, eligible loads and amounts.
9. `Create quotation client "EXACT CLIENT" route "EXACT ROUTE" for N$20000 on 2026-10-24`. Save operating-cost defaults in Rates & Quotations first. Verify per-km breakdown, margin and VAT; open the saved quotation.
10. `Edit quotation Q-1001 amount to 22000`. Verify saved selling price, expected profit, VAT and total update together. Multi-leg/legacy quotation amount changes use the quotation editor.
11. `Edit invoice INV-1001 due to 2026-11-30`. Change the record elsewhere before approval; stale approval must reject rather than overwrite it.
12. `Delete quotation Q-1001`. Cancel first; then approve on a disposable quote. Confirm history is retained. Paid invoices and trips with linked costs/invoices must refuse deletion.
13. `Show invoice INV-1001`, `List quotations`, `Show tender information`. Verify values correspond to saved records.
14. Natural-language trip/workshop examples: `Create a planned trip for client NAME on route NAME using truck ANG 12 and driver FULL NAME, date 2026-10-24, income N$10000`; `Create maintenance for truck ANG 12 on 2026-10-24, type Service, cost N$1500`. Review every resolved field.
15. Approve twice, approve after cancelling, or approve after ten minutes: never creates a second record.

## Validation

`node --test test/assistant-platform*.test.js` covers planning, permissions, stale previews, receipt assignment, quotation calculations, dependent deletion, exact load selection and the full HTTP cancel/approve/replay/POD/invoice flow using an isolated in-memory server. PostgreSQL document writes share the state transaction; a real PostgreSQL and live OCR/model round trip require deployment validation.

The full suite has two pre-existing failures reproduced on main 81a172b: the page-filters VM mock lacks matchMedia listener methods, and single-journey-bar expects no ledger-return class. They are unrelated to this change.

## Conversation, workflows and voice extension (October 2026)

The assistant now stores the last six exchanges and an unambiguous active record per account. Changing accounts clears the visible transcript; the session endpoint only returns that account's conversation. Clear chat deletes the transcript/focus without changing business records. The assistant can resolve “change the date” for a focused record and “assign it to Josef” for a focused trip. Ambiguous references require clarification.

Grouped jobs can be written as semicolon-separated commands; natural compound instructions use the configured AI interpreter. Every step runs against a sandbox copy, and a single review card lists the entire job. Approval rechecks the business state and executes in one state/document transaction. No partial execution is reported as success. Ready-load billing jobs accept “Prepare invoices for YYYY-MM”; missing POD/MDC and NBL billing requirements are reported. NBL consolidated billing still uses its existing dedicated command.

Batch capture accepts up to twenty images/PDFs, 12 MB each and 60 MB total. Use numbered lines such as:

```
1: POD trip AT-101 leg 1
2: POD trip AT-102 leg 1
3: diesel truck ANG 12
```

The existing scanner extracts receipt values. Match candidates come from explicit trip references, fleet names, registrations on receipts and filenames. Each proposed match/amount/document is reviewed. Unknown/ambiguous records, duplicates, missing fields or one failed step block the batch. Proof is stored only on approval. This is deliberate matching, not guessing which trip a truck was on.

New role-checked business actions include recording received invoice payments (no bank transfer), generating payroll drafts using existing calculations, overhead entry, creating/updating/archiving fleet/staff/client/route/compliance records, and selected operational settings. Accounts/passwords and arbitrary settings are excluded. Truck/employee archive checks live trips; employee archive also checks outstanding loans. Drivers added as employees receive matching driver records. Compliance dates sync with truck records.

“What needs attention?” checks current saved records through the platform's existing daily-task rules. Opening the assistant shows the count; it refreshes while the app is open. This does not create an independent external reminder schedule. “Why did ANG 12 profit change in YYYY-MM?” compares recorded operational contribution with the previous month and labels excluded/shared costs; it is not an audited net-profit or cash report.

Attach one tender PDF/image with “Review this tender”. The configured AI reads requirements and source references, compares supplied company/compliance evidence, and lists missing information and pricing questions. Eligibility, unreadable sections and deadlines must be verified against the original tender. This is preparation, not automatic external submission or legal certification.

“Action history” shows the account's recent changes. “Undo last job” prepares a separate reversal preview. Undo checks every affected record, rejects reference collisions or later changes, and retains audit history. Only the same user's currently matching staff role can reverse that job. Archived document bytes remain preserved; undo changes record links, not stored proof bytes.

Voice:

- Speak uses browser speech recognition when available; Record audio uses microphone recording plus server transcription.
- Transcripts appear as editable text. Dictation never sends an instruction or approves changes automatically.
- Microphone access is requested only after tapping a voice control. Recording stops at one minute or when the panel/app closes; permission denial has a text/keyboard fallback.
- Record audio uses `OPENAI_API_KEY` and `ASSISTANT_TRANSCRIBE_MODEL` (default `gpt-transcribe`). The browser's speech service may also process audio; the UI states this.
- Read aloud is an optional button on assistant replies; it uses browser speech synthesis.
- Android APK 1.4.5 / code 22 requests RECORD_AUDIO and grants microphone/camera only to the configured HTTPS server origin, only after Android permission approval. Old APKs need updating for the recording fallback.

Additional tests cover grouped job cancellation/replay/staleness, batch POD proof, role restrictions, session separation, payment baselines, payroll delegation, master record validation, undo, profit comparison, microphone denial and cancellation during a pending permission prompt. Android unit tests cover exact-origin media permissions and resource filtering. A real microphone/browser speech service, live model/OCR round trip and physical Android permission flow remain device checks.
