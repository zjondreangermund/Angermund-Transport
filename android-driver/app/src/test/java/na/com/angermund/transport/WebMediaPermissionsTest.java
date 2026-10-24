package na.com.angermund.transport;

import android.net.Uri;
import android.webkit.PermissionRequest;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
public class WebMediaPermissionsTest {
    @Test public void requiresExactTrustedHttpsOrigin() {
        String url = "https://angermund.example";
        assertTrue(WebMediaPermissions.trusted(Uri.parse(url), url));
        assertTrue(WebMediaPermissions.trusted(Uri.parse(url + ":443"), url));
        assertFalse(WebMediaPermissions.trusted(Uri.parse("http://angermund.example"), url));
        assertFalse(WebMediaPermissions.trusted(Uri.parse("https://angermund.example.attacker.test"), url));
        assertFalse(WebMediaPermissions.trusted(Uri.parse(url + ":8443"), url));
        assertFalse(WebMediaPermissions.trusted(null, url));
    }
    @Test public void grantsOnlyRequestedAndRuntimeApprovedResources() {
        String[] requested = {PermissionRequest.RESOURCE_AUDIO_CAPTURE, PermissionRequest.RESOURCE_VIDEO_CAPTURE, "unknown"};
        assertArrayEquals(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE}, WebMediaPermissions.granted(requested, false, true));
        assertArrayEquals(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}, WebMediaPermissions.granted(requested, true, false));
        assertEquals(0, WebMediaPermissions.granted(requested, false, false).length);
        assertEquals(0, WebMediaPermissions.granted(new String[]{"unknown"}, true, true).length);
    }
}
