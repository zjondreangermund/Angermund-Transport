package na.com.angermund.transport;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

/** Disk-backed, bounded FIFO. A failed upload never replaces unsent locations. */
final class GpsQueue extends SQLiteOpenHelper {
    static final int MAX_POINTS = 4096;
    static final long MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000;
    static final class Point {
        final long id;
        final String payload;
        Point(long id, String payload) { this.id = id; this.payload = payload; }
    }
    GpsQueue(Context context) { super(context, "background-gps.db", null, 1); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE points(id INTEGER PRIMARY KEY AUTOINCREMENT, captured_at INTEGER NOT NULL, payload TEXT NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}
    synchronized void add(String payload, long capturedAt) {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues values = new ContentValues();
            values.put("captured_at", capturedAt); values.put("payload", payload);
            db.insertOrThrow("points", null, values);
            prune(db);
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    private void prune(SQLiteDatabase db) {
        db.delete("points", "captured_at < ?", new String[]{String.valueOf(System.currentTimeMillis() - MAX_AGE_MS)});
        db.execSQL("DELETE FROM points WHERE id NOT IN (SELECT id FROM points ORDER BY id DESC LIMIT " + MAX_POINTS + ")");
    }
    synchronized Point first() {
        SQLiteDatabase db = getWritableDatabase(); prune(db);
        try (Cursor c = db.rawQuery("SELECT id,payload FROM points ORDER BY id LIMIT 1", null)) {
            return c.moveToFirst() ? new Point(c.getLong(0), c.getString(1)) : null;
        }
    }
    synchronized void remove(long id) { getWritableDatabase().delete("points", "id=?", new String[]{String.valueOf(id)}); }
    synchronized void clear() { getWritableDatabase().delete("points", null, null); }
    synchronized int count() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM points", null)) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }
}
