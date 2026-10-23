# Angermund Driver Android app

Native Android wrapper for the Angermund Transport Driver Easy Mode.

## Background GPS

- Uses a foreground location service so tracking continues with the screen off or WebView closed.
- Restarts after phone reboot/app update when the driver has previously enabled GPS.
- Uses a revocable server-issued device token rather than the 12-hour browser JWT.
- Posts GPS to `/api/mobile/gps`; the server resolves the driver's current trip/truck.
- Keeps a SQLite queue of up to 4,096 fixes for seven days. Retries on reconnect and every minute; acknowledged points are removed in order.
- Records a stationary heartbeat as well as movement (GPS requests every 45 seconds; actual delivery depends on the phone).
- Shows last captured location, last successful server contact, unsent count, permission and battery setup on Tracking and the Driver Workspace.
- Preserves the signed-in web session on launch; opening the app no longer forces logout.
- Clearing Recent apps does not stop the service (`stopWithTask=false`). Android force stop, revoked permissions and manufacturer restrictions can stop it. Reopen the app after Force stop.
- Old fixes are stored as history without firing delayed arrival/departure alerts. Driver fixes carry their original trip context so they cannot be silently attached to a new trip.
- Phone GPS is labelled separately on the map. Vehicle-tracker-only trip completion rules are unchanged; the office can confirm depot arrival as before.

## First phone test (v1.4.0)

1. Install the latest APK from the platform's Install App button. Open it and sign in.
2. Go to Tracking → Start background GPS test. The test phone stays separate from real trucks and never advances or closes a trip.
3. Use Tracking setup: allow precise Location **all the time**, notifications and unrestricted battery use. On Samsung remove the app from Sleeping/Deep sleeping apps.
4. Wait for a recent location and server contact. Lock the screen for five minutes, then check its timestamp from another device.
5. Clear the app from Recent apps and repeat. Restart/unlock the phone and repeat to check restart permission.
6. Switch mobile data/Wi-Fi off, move a short distance, then reconnect. Confirm saved points upload and the count drops. Historical replay does not generate late geofence transitions.
7. Stop the test when finished. Logout or stopping the test clears its saved queue.

An actual physical-device test is required; a build or unit test cannot prove Samsung background behaviour.

The driver must grant:
1. precise location,
2. notifications,
3. **Allow all the time** location access,
4. preferably unrestricted battery/background usage on Samsung/Android.

## Build

GitHub Actions workflow `build-driver-apk.yml` builds a debug-signed installable APK.


## Trip controls (v1.4.1)

- Drivers explicitly tap **Start tracking** on the assigned trip before driving. **Stop tracking** stops location collection and clears the unsent queue without completing the trip. Stop before leaving the truck on foot.
- Start/Stop is stored on the server and phone. Reopening Driver Workspace never overrides a stop. A previously started session can resume after reboot with the required permissions.
- Phone geofence trip automation accepts only recent accurate fixes for that driver's active session. Site arrivals and confirmed depot return require consecutive fixes; paused/test/historical points cannot complete a trip.
- Town checkpoints are notification-only. Exact loading/offloading pins use their saved radius and are separate from town checkpoints.
- General phone test mode remains separate from trucks and never advances trips.
