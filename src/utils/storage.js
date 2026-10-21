/**
 * Storage Layer — LocalStorage Fallback Persistence
 * The Fitness House Gym Management Admin Panel
 *
 * Provides persistent local state for members, payments, checkins, etc.
 * when running in client-side prototype demo mode.
 */

export const STORAGE_KEYS = {
  MEMBERS: 'TFH_MEMBERS_V1',
  PAYMENTS: 'TFH_PAYMENTS_V1',
  CHECKINS: 'TFH_CHECKINS_V1',
  FOLLOWUPS: 'TFH_FOLLOWUPS_V1',
  PT_CLIENTS: 'TFH_PT_CLIENTS_V1',
  PT_SESSIONS: 'TFH_PT_SESSIONS_V1',
  NOTIFICATIONS: 'TFH_NOTIFICATIONS_V1',
  GYM_INFO: 'TFH_GYM_INFO_V1',
};

/**
 * Safely loads data from localStorage with fallback to default demo data.
 */
export function loadFromStorage(key, fallback) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed !== null && parsed !== undefined ? parsed : fallback;
  } catch (err) {
    console.warn(`[Storage] Failed to read ${key} from localStorage, using fallback:`, err);
    return fallback;
  }
}

/**
 * Safely saves data to localStorage.
 */
export function saveToStorage(key, value) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`[Storage] Failed to write ${key} to localStorage:`, err);
  }
}

/**
 * Resets all TFH localStorage items to initial state.
 */
export function clearTFHStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  Object.values(STORAGE_KEYS).forEach((k) => {
    window.localStorage.removeItem(k);
  });
}

/**
 * Purges disposable test fixtures and auto-generated prototype reminder pollution
 * from localStorage keys to guarantee clean manual follow-up queues.
 */
export function purgeStaleFixturesFromStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return;

  const isStaleFixture = (item) => {
    if (!item) return false;
    const str = JSON.stringify(item);
    return (
      str.includes('TEST-ATTENDANCE') ||
      str.includes('F892') ||
      str.includes('a1111111-1111-4111-a111-111111111111') ||
      str.includes('a1111111-1111-4111-a111-111111111112') ||
      str.includes('a2222222-2222-4222-a222-222222222222') ||
      str.includes('MEM-TEST') ||
      (typeof item.id === 'string' && (item.id.startsWith('REM-') || item.id.startsWith('NOTIF-')))
    );
  };

  try {
    const rawFollowups = window.localStorage.getItem(STORAGE_KEYS.FOLLOWUPS);
    if (rawFollowups) {
      const parsed = JSON.parse(rawFollowups);
      if (Array.isArray(parsed)) {
        const seenIds = new Set();
        const cleaned = [];
        for (const item of parsed) {
          if (!isStaleFixture(item)) {
            const key = item.id || `${item.memberId}-${item.reason}`;
            if (!seenIds.has(key)) {
              seenIds.add(key);
              cleaned.push(item);
            }
          }
        }
        window.localStorage.setItem(STORAGE_KEYS.FOLLOWUPS, JSON.stringify(cleaned));
      }
    }

    const rawNotifs = window.localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
    if (rawNotifs) {
      const parsed = JSON.parse(rawNotifs);
      if (Array.isArray(parsed)) {
        const seenIds = new Set();
        const cleaned = [];
        for (const item of parsed) {
          if (!isStaleFixture(item)) {
            const key = item.id || `${item.memberId}-${item.type}-${item.scheduledDate}`;
            if (!seenIds.has(key)) {
              seenIds.add(key);
              cleaned.push(item);
            }
          }
        }
        window.localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(cleaned));
      }
    }
  } catch (err) {
    console.warn('[Storage] Error purging stale fixtures from storage:', err);
  }
}

