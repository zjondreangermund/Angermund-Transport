package na.com.angermund.transport;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.Gravity;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.FrameLayout;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int REQ_LOCATION = 2010;
    private static final int REQ_FILE = 2011;
    private static final String PREFS = "angermund_driver_gps";
    private static final String START_URL = BuildConfig.SERVER_URL + "/login";

    private WebView webView;
    private FrameLayout splashOverlay;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private String pendingJwt = "";
    private long lastExitBackAt = 0;
    private volatile boolean registeringDevice = false;
    private volatile boolean gpsRequested = false;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(0xff061421);
        getWindow().setNavigationBarColor(0xff061421);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xff061421);
        root.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(0xff061421);
        root.addView(webView);
        addNativeSplash(root);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int left, top, right, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                left = bars.left; top = bars.top; right = bars.right; bottom = bars.bottom;
            } else {
                left = insets.getSystemWindowInsetLeft();
                top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight();
                bottom = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(left, top, right, bottom);
            return insets;
        });
        setContentView(root);
        root.requestApplyInsets();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " AngermundTransportNative/1.3.2");

        webView.addJavascriptInterface(new NativeBridge(), "AngermundNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.postDelayed(MainActivity.this::hideNativeSplash, 350);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                boolean allowed = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                callback.invoke(origin, allowed, false);
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = filePathCallback;
                openFileChooser();
                return true;
            }
        });

        if (savedInstanceState == null) webView.loadUrl(START_URL);
        else webView.restoreState(savedInstanceState);

        requestNotificationPermission();
        startStoredServiceIfEnabled();
    }

    private void addNativeSplash(FrameLayout root) {
        splashOverlay = new FrameLayout(this);
        splashOverlay.setBackgroundColor(0xff061421);
        splashOverlay.setClickable(true);
        splashOverlay.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        FrameLayout.LayoutParams boxParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        box.setLayoutParams(boxParams);

        ImageView logo = new ImageView(this);
        int size = (int) (Math.min(getResources().getDisplayMetrics().widthPixels * 0.68f,
                360f * getResources().getDisplayMetrics().density));
        LinearLayout.LayoutParams logoParams = new LinearLayout.LayoutParams(size, size);
        logo.setLayoutParams(logoParams);
        logo.setScaleType(ImageView.ScaleType.CENTER_CROP);
        logo.setImageResource(R.drawable.angermund_app_icon_hq);
        box.addView(logo);

        TextView loading = new TextView(this);
        loading.setText("LOADING OPERATIONS…");
        loading.setTextColor(0xfff4f9ff);
        loading.setTextSize(12);
        loading.setLetterSpacing(0.16f);
        loading.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams textParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        textParams.topMargin = (int) (18 * getResources().getDisplayMetrics().density);
        loading.setLayoutParams(textParams);
        box.addView(loading);

        splashOverlay.addView(box);
        root.addView(splashOverlay);
    }

    private void hideNativeSplash() {
        if (splashOverlay == null) return;
        splashOverlay.animate().alpha(0f).setDuration(220).withEndAction(() -> {
            if (splashOverlay != null) {
                ViewGroup parent = (ViewGroup) splashOverlay.getParent();
                if (parent != null) parent.removeView(splashOverlay);
                splashOverlay = null;
            }
        }).start();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_LOCATION);
        }
    }

    private void requestLocationPermissions() {
        java.util.ArrayList<String> permissions = new java.util.ArrayList<>();
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.ACCESS_FINE_LOCATION);
            permissions.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (!permissions.isEmpty()) requestPermissions(permissions.toArray(new String[0]), REQ_LOCATION);
    }

    private boolean hasForegroundLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBackgroundLocation() {
        return Build.VERSION.SDK_INT < 29 || checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void startStoredServiceIfEnabled() {
        SharedPreferences p = prefs();
        if (!p.getBoolean("enabled", false) || p.getString("device_token", "").isEmpty()) return;
        try { startForegroundService(new Intent(this, NotificationService.class)); } catch (Exception ignored) {}
        if (p.getBoolean("gps_enabled", false) && hasForegroundLocation()) {
            try { startForegroundService(new Intent(this, LocationService.class)); } catch (Exception ignored) {}
        }
    }

    private void ensureRegistered(String jwt, boolean enableGps) {
        if (jwt == null || jwt.isEmpty()) return;
        if (enableGps) gpsRequested = true;
        SharedPreferences p = prefs();
        String existingToken = p.getString("device_token", "");
        if (!existingToken.isEmpty()) {
            p.edit().putBoolean("enabled", true).putBoolean("gps_enabled", p.getBoolean("gps_enabled", false) || enableGps).apply();
            startStoredServiceIfEnabled();
            if (enableGps) promptBackgroundLocation();
            return;
        }
        if (registeringDevice) return;
        registeringDevice = true;
        io.execute(() -> {
            try {
                SharedPreferences pref = prefs();
                String deviceId = pref.getString("device_id", "");
                if (deviceId.isEmpty()) {
                    deviceId = UUID.randomUUID().toString();
                    pref.edit().putString("device_id", deviceId).apply();
                }
                JSONObject body = new JSONObject();
                body.put("deviceId", deviceId);
                body.put("name", Build.MANUFACTURER + " " + Build.MODEL);
                body.put("platform", "android-" + Build.VERSION.SDK_INT);
                String result = postJson("/api/mobile/register", body.toString(), "Bearer " + jwt, null);
                JSONObject response = new JSONObject(result);
                String deviceToken = response.getString("deviceToken");
                SharedPreferences.Editor edit = pref.edit()
                        .putString("device_token", deviceToken)
                        .putBoolean("enabled", true)
                        .putBoolean("gps_enabled", gpsRequested || enableGps);
                if (pref.getString("last_alert_at", "").isEmpty())
                    edit.putString("last_alert_at", response.optString("serverTime", ""));
                edit.apply();
                runOnUiThread(() -> {
                    startStoredServiceIfEnabled();
                    if (gpsRequested || enableGps) promptBackgroundLocation();
                    toast((gpsRequested || enableGps) ? "Background alerts & driver tools enabled" : "Background alerts enabled");
                });
            } catch (Exception e) {
                runOnUiThread(() -> toast("Could not enable background alerts: " + e.getMessage()));
            } finally {
                registeringDevice = false;
            }
        });
    }

    private void promptBackgroundLocation() {
        if (!hasForegroundLocation() || hasBackgroundLocation()) {
            promptBatteryExemption();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Allow GPS all the time")
                .setMessage("For automatic trip arrival/departure tracking when the app is closed or after phone restart, open Permissions → Location and choose “Allow all the time”.")
                .setNegativeButton("Later", null)
                .setPositiveButton("Open settings", (d, which) -> {
                    Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                    startActivity(i);
                })
                .show();
    }

    private void promptBatteryExemption() {
        if (Build.VERSION.SDK_INT < 23 || prefs().getBoolean("battery_prompted", false)) return;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null && pm.isIgnoringBatteryOptimizations(getPackageName())) return;
        prefs().edit().putBoolean("battery_prompted", true).apply();
        new AlertDialog.Builder(this)
                .setTitle("Keep GPS running")
                .setMessage("Allow Angermund Driver to run without battery optimisation so Samsung/Android does not stop trip tracking in the background.")
                .setNegativeButton("Later", null)
                .setPositiveButton("Allow", (d, which) -> {
                    try {
                        Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                Uri.parse("package:" + getPackageName()));
                        startActivity(i);
                    } catch (ActivityNotFoundException ignored) {
                        startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                    }
                }).show();
    }

    private void revokeAndStop() {
        String token = prefs().getString("device_token", "");
        prefs().edit().putBoolean("enabled", false).putBoolean("gps_enabled", false).remove("device_token").remove("pending_location").remove("last_alert_at").apply();
        stopService(new Intent(this, LocationService.class));
        stopService(new Intent(this, NotificationService.class));
        if (!token.isEmpty()) io.execute(() -> {
            try { postJson("/api/mobile/revoke", "{}", null, token); } catch (Exception ignored) {}
        });
    }

    private String postJson(String path, String json, String authorization, String deviceToken) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(BuildConfig.SERVER_URL + path).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.setRequestMethod("POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        if (authorization != null) c.setRequestProperty("Authorization", authorization);
        if (deviceToken != null) c.setRequestProperty("X-Device-Token", deviceToken);
        try (OutputStream out = c.getOutputStream()) {
            out.write(json.getBytes(StandardCharsets.UTF_8));
        }
        int code = c.getResponseCode();
        BufferedReader br = new BufferedReader(new InputStreamReader(
                code >= 400 ? c.getErrorStream() : c.getInputStream(), StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = br.readLine()) != null) sb.append(line);
        if (code < 200 || code >= 300) throw new Exception(sb.length() > 0 ? sb.toString() : "HTTP " + code);
        return sb.toString();
    }

    private Uri normalizeImageForUpload(Uri source) {
        if (source == null) return null;
        try {
            String mime = getContentResolver().getType(source);
            if (mime == null || !mime.toLowerCase().startsWith("image/")) return source;

            Bitmap bitmap;
            if (Build.VERSION.SDK_INT >= 28) {
                ImageDecoder.Source decoderSource = ImageDecoder.createSource(getContentResolver(), source);
                bitmap = ImageDecoder.decodeBitmap(decoderSource, (decoder, info, src) -> {
                    decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);
                });
            } else {
                try (InputStream in = getContentResolver().openInputStream(source)) {
                    bitmap = BitmapFactory.decodeStream(in);
                }
            }
            if (bitmap == null) return source;

            final int maxSide = 2400;
            int w = bitmap.getWidth(), h = bitmap.getHeight();
            Bitmap out = bitmap;
            if (Math.max(w, h) > maxSide) {
                float scale = (float) maxSide / (float) Math.max(w, h);
                out = Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), true);
            }

            File dir = new File(getCacheDir(), "camera");
            if (!dir.exists()) dir.mkdirs();
            File jpg = new File(dir, "upload-" + System.currentTimeMillis() + ".jpg");
            try (FileOutputStream fos = new FileOutputStream(jpg)) {
                if (!out.compress(Bitmap.CompressFormat.JPEG, 92, fos)) return source;
            }

            if (out != bitmap) out.recycle();
            bitmap.recycle();
            return FileProvider.getUriForFile(this, getPackageName() + ".files", jpg);
        } catch (Exception e) {
            return source;
        }
    }

    private void openFileChooser() {
        try {
            File dir = new File(getCacheDir(), "camera");
            if (!dir.exists()) dir.mkdirs();
            File photo = new File(dir, "capture-" + System.currentTimeMillis() + ".jpg");
            cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".files", photo);

            Intent camera = new Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE);
            camera.putExtra(android.provider.MediaStore.EXTRA_OUTPUT, cameraUri);
            camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent files = new Intent(Intent.ACTION_GET_CONTENT);
            files.addCategory(Intent.CATEGORY_OPENABLE);
            files.setType("*/*");

            Intent chooser = new Intent(Intent.ACTION_CHOOSER);
            chooser.putExtra(Intent.EXTRA_INTENT, files);
            chooser.putExtra(Intent.EXTRA_TITLE, "Take photo or choose file");
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
            startActivityForResult(chooser, REQ_FILE);
        } catch (Exception e) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = null;
            toast("Could not open camera/files");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            final ValueCallback<Uri[]> callback = fileCallback;
            fileCallback = null;

            Uri chosen = null;
            if (resultCode == RESULT_OK) {
                if (data != null && data.getData() != null) chosen = data.getData();
                else if (cameraUri != null) chosen = cameraUri;
            }
            cameraUri = null;

            if (callback == null) return;
            if (chosen == null) {
                callback.onReceiveValue(null);
                return;
            }

            final Uri selected = chosen;
            io.execute(() -> {
                Uri normalized = normalizeImageForUpload(selected);
                runOnUiThread(() -> callback.onReceiveValue(new Uri[]{normalized != null ? normalized : selected}));
            });
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && hasForegroundLocation() && !pendingJwt.isEmpty()) {
            String jwt = pendingJwt;
            pendingJwt = "";
            ensureRegistered(jwt, true);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (prefs().getBoolean("enabled", false)) {
            startStoredServiceIfEnabled();
            if (prefs().getBoolean("gps_enabled", false) && hasForegroundLocation() && hasBackgroundLocation()) promptBatteryExemption();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else if (System.currentTimeMillis() - lastExitBackAt < 2000) super.onBackPressed();
        else {
            lastExitBackAt = System.currentTimeMillis();
            toast("Press Back again to exit");
        }
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }

    public class NativeBridge {
        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(MainActivity.this::finish);
        }

        @JavascriptInterface
        public void startBackgroundAlerts(String jwt) {
            runOnUiThread(() -> ensureRegistered(jwt, false));
        }

        @JavascriptInterface
        public void startBackgroundGps(String jwt) {
            runOnUiThread(() -> {
                gpsRequested = true;
                if (!hasForegroundLocation()) {
                    pendingJwt = jwt;
                    ensureRegistered(jwt, false);
                    requestLocationPermissions();
                    return;
                }
                ensureRegistered(jwt, true);
            });
        }

        @JavascriptInterface
        public void startGpsTest(String jwt, String label) {
            runOnUiThread(() -> {
                prefs().edit()
                        .putBoolean("gps_test_mode", true)
                        .putString("gps_test_label", label == null ? "Phone GPS Test" : label)
                        .apply();
                gpsRequested = true;
                if (!hasForegroundLocation()) {
                    pendingJwt = jwt;
                    ensureRegistered(jwt, false);
                    requestLocationPermissions();
                    return;
                }
                ensureRegistered(jwt, true);
                toast("Phone GPS TEST active");
            });
        }

        @JavascriptInterface
        public void stopGpsTest() {
            runOnUiThread(() -> {
                prefs().edit()
                        .putBoolean("gps_test_mode", false)
                        .putBoolean("gps_enabled", false)
                        .remove("gps_test_label")
                        .remove("pending_location")
                        .apply();
                stopService(new Intent(MainActivity.this, LocationService.class));
                toast("Phone GPS TEST stopped");
            });
        }

        @JavascriptInterface
        public void stopBackgroundGps() {
            runOnUiThread(MainActivity.this::revokeAndStop);
        }

        @JavascriptInterface
        public String getGpsStatus() {
            JSONObject o = new JSONObject();
            try {
                o.put("enabled", prefs().getBoolean("gps_enabled", false));
                o.put("backgroundPermission", hasBackgroundLocation());
                o.put("foregroundPermission", hasForegroundLocation());
                o.put("deviceRegistered", !prefs().getString("device_token", "").isEmpty());
            } catch (Exception ignored) {}
            return o.toString();
        }
    }
}
