package na.com.angermund.transport;

import static org.junit.Assert.*;
import android.content.Context;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class GpsQueueTest {
    private Context context;
    private GpsQueue queue;
    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        context.deleteDatabase("background-gps.db"); queue = new GpsQueue(context);
    }
    @After public void cleanup() { queue.close(); context.deleteDatabase("background-gps.db"); }
    @Test public void persistsMultipleOfflinePointsInOrderAcrossReopen() {
        queue.add("first", System.currentTimeMillis()); queue.add("second", System.currentTimeMillis());
        queue.close(); queue = new GpsQueue(context);
        GpsQueue.Point first = queue.first(); assertEquals("first", first.payload);
        // Reading/retrying the head does not discard it.
        assertEquals(first.id, queue.first().id); assertEquals(2, queue.count());
        queue.remove(first.id); assertEquals("second", queue.first().payload);
    }
    @Test public void removesExpiredAndClearsOnExplicitStop() {
        queue.add("expired", System.currentTimeMillis() - GpsQueue.MAX_AGE_MS - 1000);
        queue.add("fresh", System.currentTimeMillis()); assertEquals(1, queue.count());
        queue.clear(); assertNull(queue.first()); assertEquals(0, queue.count());
    }
    @Test public void keepsBoundedRecentHistory() {
        // Seed many points in one transaction; add() enforces the same production cap.
        android.database.sqlite.SQLiteDatabase db = queue.getWritableDatabase();
        db.beginTransaction();
        try {
            for (int i = 0; i < GpsQueue.MAX_POINTS; i++) db.execSQL("INSERT INTO points(captured_at,payload) VALUES(?,?)", new Object[]{System.currentTimeMillis(), "old-" + i});
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        queue.add("new", System.currentTimeMillis()); assertEquals(GpsQueue.MAX_POINTS, queue.count());
        assertEquals("old-1", queue.first().payload);
    }
}
