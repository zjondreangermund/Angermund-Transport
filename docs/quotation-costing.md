# Transport costing and quotations

Rates & Quotations now uses explicit tender kilometres and actual truck kilometres per leg. All kilometre fields are totals. Selecting a distance basis is a description, not a distance multiplier. The Add return control refuses a leg marked Round trip. For a one-way route, add an empty return only if its kilometres are not already included. Verify the return route: the existing reverse-route helper can fall back to the same route when no reverse record exists.

Starting editable assumptions from the supplied costing screenshot: 2 km/L, Namibia diesel N$28.75/L, driver N$0.50/km, MDC N$73.30/100 Namibian km, maintenance N$2.50/km, tyres N$1.50/km, insurance N$1/km, ownership/overhead N$3/km and food N$200/day for two days. Outside-Namibia fuel starts at N$26.76/L. These are estimate inputs supplied for this task, not live prices. Fuel allocation uses country kilometres at the selected km/L; adjust prices for the actual refuelling plan. Foreign fuel prices must be in NAD equivalent.

Default target margin is 10%, following the tender screenshot; change to 18% to reproduce the PDF. Margin means cost / (1 - margin), not a markup. A minimum selling price is configurable and defaults to zero rather than inventing a local minimum. Rounding defaults to the next N$1,000 and can be disabled.

The PDF reference has N$33,451.20 total cost. Its unrounded 18% margin price should be N$40,794.15; the displayed N$40,791.15 is an arithmetic discrepancy. Both round to N$41,000, giving N$7,548.80 profit and 18.41% actual margin.

Save rate defaults to reuse assumptions. Save quotation stores its inputs, cost breakdown, leg prices, route/client labels, company details, VAT and terms. Revise creates another quotation linked to the original, preserving the original record. Older quotations remain readable and explicitly report when detailed costs or VAT were not saved. Current quote drafts are held while navigating within the running app; save before closing/reloading.

Customer PDF excludes internal cost/profit details. Internal costing PDF and Excel are separate controls in the saved quote dialog. Excel uses the existing authenticated workbook export endpoint. The rate schedule export lists saved quotes including revisions; it does not import or certify the entire attached tender workbook. Only the supplied screenshots were readable in this session, so hidden columns, full workbook formulas and every route have not been validated or imported. Confirm VAT treatment and terms for each quotation before issuing.

Validation: JavaScript syntax parsed and six arithmetic/validation cases executed in the available JavaScript tool runtime. No shell runtime or browser was available, so native Node tests and live UI/download checks have not run. To run the committed tests locally:
`node --test test/quote-costing.test.js`
`npm run check`
