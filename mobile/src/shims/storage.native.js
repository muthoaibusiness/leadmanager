// The shared data layer (src/lib/db.js, auth.js) is written against the
// browser's synchronous localStorage. expo-sqlite provides the same API on the
// phone, backed by SQLite, so the cache and the session survive a restart.
import 'expo-sqlite/localStorage/install';
