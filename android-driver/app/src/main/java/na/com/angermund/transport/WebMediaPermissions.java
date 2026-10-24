package na.com.angermund.transport;

import android.net.Uri;
import android.webkit.PermissionRequest;
import java.util.ArrayList;

/** Only the configured HTTPS application origin can request camera/microphone. */
final class WebMediaPermissions {
    private WebMediaPermissions() {}

    static boolean trusted(Uri origin, String serverUrl) {
        if (origin == null) return false;
        Uri server = Uri.parse(serverUrl);
        int originPort = origin.getPort() == -1 ? 443 : origin.getPort();
        int serverPort = server.getPort() == -1 ? 443 : server.getPort();
        return "https".equalsIgnoreCase(origin.getScheme())
            && "https".equalsIgnoreCase(server.getScheme())
            && server.getHost() != null
            && server.getHost().equalsIgnoreCase(origin.getHost())
            && originPort == serverPort;
    }

    static String[] granted(String[] requested, boolean camera, boolean microphone) {
        ArrayList<String> safe = new ArrayList<>();
        for (String resource : requested) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource) && camera) safe.add(resource);
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource) && microphone) safe.add(resource);
        }
        return safe.toArray(new String[0]);
    }
}
