// The app's one context: who is signed in, and a counter that re-renders
// screens after the shared store (src/lib/db.js) changes. The web app's
// AppContext plays the same part; the convention is the same:
//   call a db.js function, then refresh().
//
// Boot follows the web app's three paths (src/App.jsx mount effect):
//   no session            -> login screen, nothing fetched
//   session + warm cache  -> the app renders from the cache at once; the token
//                            is verified and the data refreshed underneath
//   session + cold cache  -> the one path that waits behind the loader
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getSession, hasSessionId, clearLocalDB, cacheBelongsTo, applyRealtimeEvent, getDB } from '../../src/lib/db.js';
import { restoreSession, signOut as authSignOut } from '../../src/lib/auth.js';
import { sbSubscribeAll } from '../../src/lib/supabase.js';
import { hydrateFromCloud } from './boot';
import { registerPush, unregisterPush } from './push';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [user, setUser] = useState(() => getSession());
  // True while there is a session but nothing to show yet.
  const [booting, setBooting] = useState(() => hasSessionId() && !getSession());
  const [syncing, setSyncing] = useState(false);
  const [dbVersion, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const load = useCallback(async (u) => {
    setSyncing(true);
    try { await hydrateFromCloud(u); } catch (e) { console.warn('[boot] load failed:', e); }
    setSyncing(false);
    refresh();
  }, [refresh]);

  // After a successful sign-in (LoginScreen).
  const enter = useCallback(async (u) => {
    if (!cacheBelongsTo(u.id)) clearLocalDB();
    const warm = (getDB().leads || []).length > 0;
    if (!warm) setBooting(true);
    setUser(u);
    await load(u);
    setBooting(false);
    registerPush(u);
  }, [load]);

  const signOut = useCallback(async () => {
    await unregisterPush();
    authSignOut(); // ends the session and clears the cache (not awaited: the UI leaves at once)
    setUser(null);
  }, []);

  // Mount: restore the session once.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!hasSessionId()) return;
    const cached = getSession();
    (async () => {
      const u = await restoreSession();
      if (u && u.offline) { setBooting(false); return; } // keep the cached shell
      if (!u || (cached && u.id !== cached.id)) { clearLocalDB(); setUser(null); setBooting(false); return; }
      setUser(u);
      await load(u);
      setBooting(false);
      registerPush(u);
    })();
  }, [load]);

  // Live changes from the server, folded into the store by the shared code.
  // Keyed on the account id: a fresh user object for the same account (after a
  // reload of its row) must not drop and reopen the socket.
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);
  const userId = user ? user.id : null;
  useEffect(() => {
    if (!userId) return undefined;
    let timer = null;
    const unsub = sbSubscribeAll((table, type, record, oldRecord, errors) => {
      const changed = applyRealtimeEvent(table, type, record, oldRecord, userRef.current, errors);
      // One re-render for a burst of events.
      if (changed && !timer) timer = setTimeout(() => { timer = null; refresh(); }, 120);
    }, userRef.current);
    return () => { if (timer) clearTimeout(timer); if (unsub) unsub(); };
  }, [userId, refresh]);

  // Back from the background: the socket may have been cut, so re-read.
  useEffect(() => {
    if (!user) return undefined;
    let last = Date.now();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { last = Date.now(); return; }
      if (Date.now() - last > 60 * 1000) load(user);
    });
    return () => sub.remove();
  }, [user, load]);

  const value = useMemo(() => ({ user, setUser, booting, syncing, dbVersion, refresh, enter, signOut, reload: () => load(user) }),
    [user, booting, syncing, dbVersion, refresh, enter, signOut, load]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
