// IndexedDB 저장소 (폰 로컬)
const DB_NAME = 'wodlog';
const DB_VER = 1;

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('workouts')) {
        const s = db.createObjectStore('workouts', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
  });
}

export async function listWorkouts() {
  const all = await tx('workouts', 'readonly', s => s.getAll());
  return all.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}
export const getWorkout = id => tx('workouts', 'readonly', s => s.get(id));
export const putWorkout = w => tx('workouts', 'readwrite', s => s.put(w));
export const deleteWorkout = id => tx('workouts', 'readwrite', s => s.delete(id));

export async function getSetting(key, def) {
  const v = await tx('kv', 'readonly', s => s.get(key));
  return v === undefined ? def : v;
}
export const setSetting = (key, val) => tx('kv', 'readwrite', s => s.put(val, key));

export async function exportAll() {
  const workouts = await tx('workouts', 'readonly', s => s.getAll());
  const keys = await tx('kv', 'readonly', s => s.getAllKeys());
  const vals = await tx('kv', 'readonly', s => s.getAll());
  const settings = Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
  return { app: 'wodlog', version: 1, exportedAt: new Date().toISOString(), workouts, settings };
}

// 같은 id 는 덮어쓰고 나머지는 유지 (병합)
export async function importAll(data) {
  if (!data || data.app !== 'wodlog' || !Array.isArray(data.workouts)) throw new Error('wodlog 백업 파일이 아닙니다');
  const db = await open();
  await new Promise((resolve, reject) => {
    const t = db.transaction(['workouts', 'kv'], 'readwrite');
    for (const w of data.workouts) t.objectStore('workouts').put(w);
    for (const [k, v] of Object.entries(data.settings || {})) t.objectStore('kv').put(v, k);
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  return data.workouts.length;
}
