# Angermund Transport ERP

Recovered and rebuilt transport management system for Angermund Transport CC.

## Included

- Dashboard with revenue, costs, profit, distance and compliance alerts
- Trips with automatic distance and profit calculations
- Fleet, drivers, diesel, expenses, maintenance, permits and invoices
- Diesel-based rate calculator
- Route and performance reports
- CSV import/export and full JSON backup/restore
- Responsive installable PWA
- Node.js server and Railway configuration
- Works locally without a database; data is kept in the browser

## Run locally

```bash
npm start
```

Open `http://localhost:3000`.

## Railway

Push the repository to GitHub, create a Railway project from the repository and deploy. Railway detects the included configuration and runs `npm start`.

## Important data note

This recovery build stores operational data in the current browser using local storage. Use **Settings & Data → Download full backup** regularly. A future shared multi-user version should connect the same interface to PostgreSQL with authenticated users.
