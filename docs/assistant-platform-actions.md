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
