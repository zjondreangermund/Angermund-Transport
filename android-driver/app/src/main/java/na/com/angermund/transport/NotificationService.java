package na.com.angermund.transport;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class NotificationService extends Service {
    private static final String PREFS = "angermund_driver_gps";
    private static final String BACKGROUND_CHANNEL = "angermund_background_alerts";
    private static final String ALERT_CHANNEL = "angermund_operational_alerts";
    private static final int FOREGROUND_ID = 4501;
    private static final long POLL_MS = 60_000L;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler handler = new Handler(Looper.getMainLooper());

    private final Runnable pollRunnable = new Runnable() {
        @Override public void run() {
            pollAlerts();
            handler.postDelayed(this, POLL_MS);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        createChannels();
        startForeground(FOREGROUND_ID, backgroundNotification());
        handler.post(pollRunnable);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            NotificationChannel bg = new NotificationChannel(BACKGROUND_CHANNEL, "Angermund background service", NotificationManager.IMPORTANCE_LOW);
            bg.setDescription("Keeps operational alerts active when the app is closed");
            bg.setShowBadge(false);
            nm.createNotificationChannel(bg);
            NotificationChannel alerts = new NotificationChannel(ALERT_CHANNEL, "Angermund operational alerts", NotificationManager.IMPORTANCE_HIGH);
            alerts.setDescription("Trip, task, fleet, document and operational alerts");
            alerts.enableVibration(true);
            nm.createNotificationChannel(alerts);
        }
    }

    private PendingIntent openAppIntent() {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification backgroundNotification() {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, BACKGROUND_CHANNEL) : new Notification.Builder(this);
        return b.setContentTitle("Angermund alerts active")
                .setContentText("Trip and task alerts will arrive in the background")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openAppIntent())
                .build();
    }

    private void showAlert(JSONObject a) {
        String title = a.optString("title", "Angermund Transport");
        String message = a.optString("message", "New operational alert");
        String id = a.optString("id", title + message);

        Set<String> saved = prefs().getStringSet("seen_alert_ids", null);
        Set<String> seen = saved == null ? new HashSet<>() : new HashSet<>(saved);
        if (seen.contains(id)) return;

        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, ALERT_CHANNEL) : new Notification.Builder(this);
        Notification n = b.setContentTitle(title)
                .setContentText(message)
                .setStyle(new Notification.BigTextStyle().bigText(message))
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setAutoCancel(true)
                .setContentIntent(openAppIntent())
                .build();
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(Math.abs(id.hashCode()), n);
        if (seen.size() >= 200) seen.clear();
        seen.add(id);
        prefs().edit().putStringSet("seen_alert_ids", seen).apply();
    }

    private void pollAlerts() {
        String token = prefs().getString("device_token", "");
        if (token.isEmpty() || !prefs().getBoolean("enabled", false)) {
            stopSelf();
            return;
        }
        io.execute(() -> {
            HttpURLConnection c = null;
            try {
                String after = prefs().getString("last_alert_at", "");
                if (after.isEmpty()) after = Build.VERSION.SDK_INT >= 26 ? Instant.now().minusSeconds(300).toString() : "";
                String url = BuildConfig.SERVER_URL + "/api/mobile/alerts?after=" + URLEncoder.encode(after, "UTF-8");
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(12_000);
                c.setReadTimeout(18_000);
                c.setRequestMethod("GET");
                c.setRequestProperty("X-Device-Token", token);
                int code = c.getResponseCode();
                if (code == 401 || code == 403) {
                    prefs().edit().putBoolean("enabled", false).remove("device_token").apply();
                    stopSelf();
                    return;
                }
                if (code < 200 || code >= 300) return;
                StringBuilder sb = new StringBuilder();
                try (BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                    String line; while ((line = br.readLine()) != null) sb.append(line);
                }
                JSONObject result = new JSONObject(sb.toString());
                JSONArray alerts = result.optJSONArray("alerts");
                String latest = after;
                if (alerts != null) {
                    for (int i = 0; i < alerts.length(); i++) {
                        JSONObject a = alerts.optJSONObject(i);
                        if (a == null) continue;
                        showAlert(a);
                        String at = a.optString("createdAt", "");
                        if (!at.isEmpty()) latest = at;
                    }
                }
                if (!latest.isEmpty()) prefs().edit().putString("last_alert_at", latest).apply();
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (!prefs().getBoolean("enabled", false) || prefs().getString("device_token", "").isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        pollAlerts();
        return START_STICKY;
    }

    @Override public void onDestroy() {
        handler.removeCallbacks(pollRunnable);
        io.shutdownNow();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
