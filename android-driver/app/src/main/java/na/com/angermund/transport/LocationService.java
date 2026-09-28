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
    private static final float MIN_DISTANCE_M = 75f;

    private LocationManager manager;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private long lastAcceptedAt = 0;

    private final Runnable retryRunnable = new Runnable() {
        @Override public void run() {
            retryPending();
            handler.postDelayed(this, 120_000L);
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForeground(NOTIFICATION_ID, notification("Background GPS active", "Waiting for location…"));
        manager = (LocationManager) getSystemService(LOCATION_SERVICE);
        requestUpdates();
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

    private void updateNotification(String text) {
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE))
                .notify(NOTIFICATION_ID, notification("Angermund GPS active", text));
    }

    private void requestUpdates() {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            updateNotification("Location permission required");
            return;
        }
        try {
            if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER))
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, MIN_TIME_MS, MIN_DISTANCE_M, this);
        } catch (Exception ignored) {}
        try {
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 90_000L, 150f, this);
        } catch (Exception ignored) {}
    }

    @Override
    public void onLocationChanged(Location location) {
        long now = System.currentTimeMillis();
        if (now - lastAcceptedAt < 30_000L) return;
        lastAcceptedAt = now;
        try {
            JSONObject j = new JSONObject();
            j.put("latitude", location.getLatitude());
            j.put("longitude", location.getLongitude());
            j.put("speed", location.hasSpeed() ? location.getSpeed() * 3.6 : 0);
            j.put("heading", location.hasBearing() ? location.getBearing() : 0);
            j.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
            j.put("recordedAt", Build.VERSION.SDK_INT >= 26 ? Instant.ofEpochMilli(location.getTime()).toString() : String.valueOf(location.getTime()));
            String payload = j.toString();
            prefs().edit().putString("pending_location", payload).apply();
            sendPayload(payload);
        } catch (Exception ignored) {}
    }

    private void retryPending() {
        String pending = prefs().getString("pending_location", "");
        if (!pending.isEmpty()) sendPayload(pending);
    }

    private void sendPayload(String payload) {
        String token = prefs().getString("device_token", "");
        if (token.isEmpty() || !prefs().getBoolean("enabled", false)) return;
        io.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(BuildConfig.SERVER_URL + "/api/mobile/gps").openConnection();
                c.setConnectTimeout(15_000);
                c.setReadTimeout(20_000);
                c.setRequestMethod("POST");
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("X-Device-Token", token);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(payload.getBytes(StandardCharsets.UTF_8));
                }
                int code = c.getResponseCode();
                if (code == 201) {
                    StringBuilder sb = new StringBuilder();
                    try (BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                        String line; while ((line = br.readLine()) != null) sb.append(line);
                    }
                    JSONObject r = new JSONObject(sb.toString());
                    String trip = r.optString("tripId", "active trip");
                    String vehicle = r.optString("vehicleId", "");
                    prefs().edit().remove("pending_location").apply();
                    handler.post(() -> updateNotification((vehicle.isEmpty() ? "" : vehicle + " · ") + trip + " · last GPS sent"));
                } else if (code == 204) {
                    prefs().edit().remove("pending_location").apply();
                    handler.post(() -> updateNotification("Waiting for an assigned trip"));
                } else if (code == 401 || code == 403) {
                    prefs().edit().putBoolean("enabled", false).remove("device_token").apply();
                    handler.post(() -> {
                        updateNotification("Sign in again to resume GPS");
                        stopSelf();
                    });
                }
            } catch (Exception e) {
                handler.post(() -> updateNotification("Offline · latest GPS will retry"));
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!prefs().getBoolean("enabled", false) || prefs().getString("device_token", "").isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        requestUpdates();
        retryPending();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(retryRunnable);
        try { if (manager != null) manager.removeUpdates(this); } catch (Exception ignored) {}
        io.shutdownNow();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
    @Override public void onProviderEnabled(String provider) {}
    @Override public void onProviderDisabled(String provider) {}
}
