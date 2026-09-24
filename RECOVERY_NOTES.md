# Recovery notes

This repository was reconstructed on 24 September 2026 after the original Angermund Transport repository was lost.

## Evidence used

- The surviving `Angermund_Transport_ERP_Full_Site.zip` created on 17 May 2026.
- The previous V21–V23 feature history: connected operational tabs, Excel/CSV sync, smart trip generation, driver/truck auto-add, bulk import and backup/export.
- `Angermund_Transport_Full_System.xlsx` schemas for Trips, Diesel, Payroll and Site Labour.
- `Angermund_Transport_Full_Transport_Management_Workbook.xlsx` for dashboard, trip profitability, diesel control, service schedule, driver advances and rate-calculator logic.

## Recovery scope

The original later source archive was not available byte-for-byte. This is a clean reconstruction of its confirmed workflows, with a Railway-ready Node server and an offline-capable web interface. The original three-file static dashboard is preserved under `legacy-recovered/` for provenance.

## Next production upgrade

The present build is deliberately dependency-free and stores data per browser. Before granting access to multiple simultaneous users, add authentication and a PostgreSQL persistence layer, then migrate the existing JSON backup structure into database tables.

## Professional V2 upgrade — 24 September 2026

The recovered shell was upgraded into a role-based transport operations suite. The shared data model links trips to drivers, trucks, trailers, routes, clients, diesel, inspections, advances, PODs and invoices. Driver-facing screens intentionally exclude company profit and finance controls. Operational rules recovered from prior Angermund Transport work were added to the role centre, compliance workflow, driver incentive engine and cross-border checklist.
