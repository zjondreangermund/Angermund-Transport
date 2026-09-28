package na.com.angermund.transport;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) return;

        SharedPreferences p = context.getSharedPreferences("angermund_driver_gps", Context.MODE_PRIVATE);
        if (!p.getBoolean("enabled", false) || p.getString("device_token", "").isEmpty()) return;

        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(new Intent(context, NotificationService.class));
            else context.startService(new Intent(context, NotificationService.class));
        } catch (Exception ignored) {}

        if (!p.getBoolean("gps_enabled", false)) return;
        boolean foreground = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                || context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean background = Build.VERSION.SDK_INT < 29
                || context.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!foreground || !background) return;
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(new Intent(context, LocationService.class));
            else context.startService(new Intent(context, LocationService.class));
        } catch (Exception ignored) {}
    }
}
