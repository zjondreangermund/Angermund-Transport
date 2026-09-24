# Angermund Transport Operations Suite V3

Professional, role-based transport operations system for Angermund Transport CC.

## Included

- Secure JWT sign-in and server-enforced roles for Admin, Manager, Dispatch, Driver, Warehouse, Workshop and Finance
- PostgreSQL central database with real-time multi-device synchronization
- Live driver GPS and third-party telematics webhook ingestion
- Fleet map, 24-hour route-history API, geofences and automatic entry/exit alerts
- In-app, browser push, WhatsApp Cloud API and email alert adapters
- Linked dispatch lifecycle: planned → loading → in transit → delivered/POD → invoiced
- Driver workspace with assignments, GPS check-ins, inspections, diesel and POD actions
- Driver role requirements and NBL no-passenger policy
- Fleet/GPS, vehicle availability and service alerts
- Pre/post-trip inspections and defect escalation
- Diesel control linked to trip, vehicle and driver
- Driver fuel incentive calculation, including South Africa override
- Trip-by-trip driver settlements combining diesel incentive, approved receipted expenses and advance reconciliation
- Route expense receipts and trip problem logs for delays, breakdowns, tyres, route deviations, cargo and customer issues
- Workshop, maintenance and tyre lifecycle registers
- Driver, vehicle and cross-border document compliance
- Incident, damage and progressive-discipline workflow
- Clients, routes, rate calculator, standing fees, invoices and debtors
- Payroll preparation, driver advances, tasks and manager approvals
- P&L, vehicle/driver performance and audit history
- OCR-powered, human-reviewed smart document scanning; unclear amounts are never auto-posted
- REST API for users, shared state, GPS, route history, geofences, alerts, push subscriptions and scans
- CSV exports and complete JSON backup/restore
- Responsive installable PWA with Railway-ready Node.js server

## Run locally

```bash
cp .env.example .env
npm install
npm start
```

Open `http://localhost:3000`.

The development login is `admin@angermund.local` / `ChangeMe123!`. Change `INITIAL_ADMIN_PASSWORD` and `JWT_SECRET` before deployment.

## Production configuration

Required for shared multi-device operation:

- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: long random signing secret
- `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD`: first administrator

Optional integrations are configured in `.env.example`: Meta WhatsApp Cloud API, Resend email, Web Push VAPID keys and a telematics webhook token. The webhook accepts normalized GPS payloads at `POST /api/integrations/telematics/webhook` using the `X-Telematics-Token` header.

## Railway

Push the repository to GitHub, create a Railway project from the repository, add PostgreSQL, configure the environment variables above and deploy. Railway detects the included configuration and runs `npm start`.

## Important data note

PostgreSQL is the production source of truth. The browser keeps a local copy for resilience, while Server-Sent Events update connected devices after state, GPS and alert changes. Without `DATABASE_URL`, the server deliberately uses a temporary in-memory development store.

## Security and operations

- TLS/HTTPS must be enabled by the hosting platform.
- Provider secrets belong in environment variables and must never be committed.
- Create staff accounts through the protected `POST /api/users` endpoint; only administrators may create users.
- GPS and operational mutations require authentication, except the token-protected telematics webhook.
- OCR results always enter review status and require human confirmation before becoming operational records.
