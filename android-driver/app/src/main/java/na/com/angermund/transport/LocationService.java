package na.com.angermund.transport;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.SystemClock;
import java.util.concurrent.atomic.AtomicBoolean;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class LocationService extends Service implements LocationListener {
    private static final String PREFS = "angermund_driver_gps";
    private static final String CHANNEL = "angermund_gps";
    private static final int NOTIFICATION_ID = 4401;
    private static final long MIN_TIME_MS = 45_000L;
    private static final float MIN_DISTANCE_M = 0f;

    private LocationManager manager;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private long lastAcceptedAt = 0;
    private GpsQueue queue;
    private ConnectivityManager connectivity;
    private final AtomicBoolean uploading = new AtomicBoolean(false);
    private volatile boolean destroyed = false;
    private boolean foregroundReady = false;
    private final ConnectivityManager.NetworkCallback networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) { retryPending(); }
    };

    private final Runnable retryRunnable = new Runnable() {
        @Override public void run() {
            if (!trackingEnabled()) { stopSelf(); return; }
            prefs().edit().putLong("gps_service_heartbeat", System.currentTimeMillis()).apply();
            requestUpdates();
            retryPending();
            handler.postDelayed(this, 60_000L);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        queue = new GpsQueue(this);
        manager = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (!trackingEnabled()) { stopSelf(); return; }
        try {
            startForeground(NOTIFICATION_ID, notification("Angermund GPS", "Waiting for location…"));
            foregroundReady = true;
        } catch (SecurityException e) {
            status("Location permission required · open app"); stopSelf(); return;
        }
        prefs().edit().putLong("gps_service_started", System.currentTimeMillis()).apply();
        // Migrate the old single pending point once, preserving its original timestamp.
        String old = prefs().getString("pending_location", "");
        if (!old.isEmpty()) {
            try { JSONObject point = new JSONObject(old); queue.add(old, Instant.parse(point.getString("recordedAt")).toEpochMilli()); }
            catch (Exception ignored) {}
            prefs().edit().remove("pending_location").apply();
        }
        connectivity = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        try { connectivity.registerDefaultNetworkCallback(networkCallback); } catch (Exception ignored) {}
        handler.post(retryRunnable);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel c = new NotificationChannel(CHANNEL, "Driver GPS tracking", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("Keeps Angermund trip GPS running in the background");
            c.setShowBadge(false);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(c);
        }
    }

    private Notification notification(String title, String text) {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return b.setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pi)
                .build();
    }

    private boolean trackingEnabled() {
        return !destroyed && prefs().getBoolean("enabled", false) && prefs().getBoolean("gps_enabled", false)
                && !prefs().getString("device_token", "").isEmpty()
                && (prefs().getBoolean("gps_test_mode", false) || prefs().getBoolean("trip_tracking_enabled", false));
    }

    private void status(String text) {
        prefs().edit().putString("gps_status", text).apply();
        handler.post(() -> {
            if (!destroyed) ((NotificationManager) getSystemService(NOTIFICATION_SERVICE))
                .notify(NOTIFICATION_ID, notification(prefs().getBoolean("gps_test_mode", false)
                        ? "Angermund GPS TEST active" : "Angermund background GPS", text));
        });
    }

    private void requestUpdates() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            status("Location permission required · open app");
            stopSelf(); return;
        }
        try {
            if (Build.VERSION.SDK_INT >= 28 && !manager.isLocationEnabled()) status("Phone location is off · turn on Location");
            if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER))
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, MIN_TIME_MS, MIN_DISTANCE_M, this);
        } catch (Exception ignored) {}
        try {
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 60_000L, MIN_DISTANCE_M, this);
        } catch (Exception ignored) {}
    }

    @Override
    public void onLocationChanged(Location location) {
        if (!trackingEnabled()) return;
        long now = SystemClock.elapsedRealtime();
        long age = (SystemClock.elapsedRealtimeNanos() - location.getElapsedRealtimeNanos()) / 1_000_000L;
        if (age < 0 || age > 120_000L || (location.hasAccuracy() && location.getAccuracy() > 200f)) return;
        if (lastAcceptedAt > 0 && now - lastAcceptedAt < 30_000L) return;
        lastAcceptedAt = now;
        try {
            JSONObject j = new JSONObject();
            j.put("latitude", location.getLatitude());
            j.put("longitude", location.getLongitude());
            j.put("speed", location.hasSpeed() ? location.getSpeed() * 3.6 : 0);
            j.put("heading", location.hasBearing() ? location.getBearing() : 0);
            j.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
            j.put("recordedAt", Build.VERSION.SDK_INT >= 26 ? Instant.ofEpochMilli(location.getTime()).toString() : String.valueOf(location.getTime()));
            boolean testMode = prefs().getBoolean("gps_test_mode", false);
            j.put("testMode", testMode);
            if (testMode) j.put("testLabel", prefs().getString("gps_test_label", "Phone GPS Test"));
            if (!testMode) j.put("capturedTripId", prefs().getString("gps_capture_trip", ""));
            j.put("pointId", java.util.UUID.randomUUID().toString());
            queue.add(j.toString(), location.getTime());
            prefs().edit().putLong("gps_last_captured", location.getTime()).apply();
            retryPending();
        } catch (Exception ignored) {}
    }

    private void retryPending() {
        if (!trackingEnabled() || queue == null || !uploading.compareAndSet(false, true)) return;
        try { io.execute(() -> {
            String token = prefs().getString("device_token", "");
            try {
                refreshTripContext(token);
                // Bound a replay pass so a long outage cannot monopolise the service.
                for (int sent = 0; sent < 100 && trackingEnabled(); sent++) {
                    GpsQueue.Point point = queue.first();
                    if (point == null) break;
                    HttpURLConnection c = null;
                    try {
                        c = connection("/api/mobile/gps", token);
                        c.setRequestMethod("POST"); c.setDoOutput(true);
                        c.setRequestProperty("Content-Type", "application/json");
                        try (OutputStream out = c.getOutputStream()) { out.write(point.payload.getBytes(StandardCharsets.UTF_8)); }
                        int code = c.getResponseCode();
                        if (!token.equals(prefs().getString("device_token", "")) || !trackingEnabled()) break;
                        if (code == 201 || code == 204) {
                            queue.remove(point.id);
                            prefs().edit().putLong("gps_last_uploaded", System.currentTimeMillis()).apply();
                            String gpsText=code == 204 ? "Waiting for an assigned trip" : "Location sent · " + queue.count() + " waiting";
                            if (code == 201 && !prefs().getBoolean("gps_test_mode", false)) {
                                try (BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                                    StringBuilder body = new StringBuilder();String line;
                                    while ((line = br.readLine()) != null) body.append(line);
                                    JSONObject reply = new JSONObject(body.toString());
                                    JSONObject progress = reply.optJSONObject("tripProgress");
                                    JSONObject next = progress == null ? null : progress.optJSONObject("navigation");
                                    if (next != null) {
                                        gpsText = String.format(java.util.Locale.US,"To %s: %.1f km (straight line) · From %s: %.1f km travelled",
                                            next.optString("next","next geofence"),next.optDouble("toNextKm",0),
                                            next.optString("previous","previous geofence"),next.optDouble("fromPreviousKm",0));
                                    }
                                } catch (Exception ignored) { /* GPS was posted; display the normal status if optional context fails */ }
                            }
                            status(gpsText);
                        } else if (code == 401 || code == 403) {
                            prefs().edit().putBoolean("gps_enabled", false).remove("device_token").apply();
                            queue.clear(); status("Sign in again to resume GPS"); handler.post(this::stopSelf); break;
                        } else if (code == 400 || code == 422) {
                            queue.remove(point.id); status("Invalid location skipped");
                        } else { status("Upload delayed · " + queue.count() + " saved on phone"); break; }
                    } finally { if (c != null) c.disconnect(); }
                }
            } catch (Exception e) { if (trackingEnabled()) status("Offline · " + queue.count() + " saved on phone"); }
            finally { uploading.set(false); }
        }); } catch (java.util.concurrent.RejectedExecutionException e) { uploading.set(false); }
    }

    private HttpURLConnection connection(String path, String token) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(BuildConfig.SERVER_URL + path).openConnection();
        c.setConnectTimeout(15_000); c.setReadTimeout(20_000);
        c.setRequestProperty("X-Device-Token", token);
        return c;
    }

    private void refreshTripContext(String token) throws Exception {
        if (prefs().getBoolean("gps_test_mode", false)) return;
        HttpURLConnection c = connection("/api/mobile/context", token);
        try {
            if (c.getResponseCode() != 200) return;
            StringBuilder sb = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                String line; while ((line = br.readLine()) != null) sb.append(line);
            }
            JSONObject trip = new JSONObject(sb.toString()).optJSONObject("trip");
            JSONObject tracking = trip == null ? null : trip.optJSONObject("phoneTracking");
            if (tracking == null || !tracking.optBoolean("active", false)) {
                prefs().edit().putBoolean("trip_tracking_enabled", false).putBoolean("gps_enabled", false).apply();
                queue.clear(); status("Trip tracking stopped · tap Start on your trip"); handler.post(this::stopSelf); return;
            }
            if (token.equals(prefs().getString("device_token", "")))
                prefs().edit().putString("gps_capture_trip", trip == null ? "" : trip.optString("id", "")).apply();
        } finally { c.disconnect(); }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!foregroundReady || !trackingEnabled()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        requestUpdates();
        retryPending();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        prefs().edit().remove("gps_service_heartbeat").apply();
        handler.removeCallbacks(retryRunnable);
        try { if (connectivity != null) connectivity.unregisterNetworkCallback(networkCallback); } catch (Exception ignored) {}
        try { if (manager != null) manager.removeUpdates(this); } catch (Exception ignored) {}
        io.shutdownNow();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
    @Override public void onProviderEnabled(String provider) { requestUpdates(); }
    @Override public void onProviderDisabled(String provider) { status("Location provider off · check phone Location"); }
}
