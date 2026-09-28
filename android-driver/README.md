# Angermund Driver Android app

Native Android wrapper for the Angermund Transport Driver Easy Mode.

## Background GPS

- Uses a foreground location service so tracking continues with the screen off or WebView closed.
- Restarts after phone reboot/app update when the driver has previously enabled GPS.
- Uses a revocable server-issued device token rather than the 12-hour browser JWT.
- Posts GPS to `/api/mobile/gps`; the server resolves the driver's current trip/truck.
- Keeps the latest unsent point and retries after temporary network loss.

The driver must grant:
1. precise location,
2. notifications,
3. **Allow all the time** location access,
4. preferably unrestricted battery/background usage on Samsung/Android.

## Build

GitHub Actions workflow `build-driver-apk.yml` builds a debug-signed installable APK.
