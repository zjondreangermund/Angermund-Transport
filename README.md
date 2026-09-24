# Angermund Transport Operations Suite

Professional, role-based transport operations system for Angermund Transport CC.

## Included

- Role-specific navigation for Admin, Dispatch, Driver, Workshop and Finance
- Linked dispatch lifecycle: planned → loading → in transit → delivered/POD → invoiced
- Driver workspace with assignments, GPS check-ins, inspections, diesel and POD actions
- Driver role requirements and NBL no-passenger policy
- Fleet/GPS, vehicle availability and service alerts
- Pre/post-trip inspections and defect escalation
- Diesel control linked to trip, vehicle and driver
- Driver fuel incentive calculation, including South Africa override
- Workshop, maintenance and tyre lifecycle registers
- Driver, vehicle and cross-border document compliance
- Incident, damage and progressive-discipline workflow
- Clients, routes, rate calculator, standing fees, invoices and debtors
- Payroll preparation, driver advances, tasks and manager approvals
- P&L, vehicle/driver performance and audit history
- Human-reviewed smart document inbox; unclear scan amounts are never auto-posted
- CSV exports and complete JSON backup/restore
- Responsive installable PWA with Railway-ready Node.js server

## Run locally

```bash
npm start
```

Open `http://localhost:3000`.

## Railway

Push the repository to GitHub, create a Railway project from the repository and deploy. Railway detects the included configuration and runs `npm start`.

## Important data note

This build stores operational data in the current browser using local storage. Use **Settings & Data → Download backup** regularly. For live use across several devices, connect this same interface to authenticated users and PostgreSQL.
