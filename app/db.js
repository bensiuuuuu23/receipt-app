/* 本機資料庫（IndexedDB）—— 單據 receipts、供應商記憶 suppliers */
const DB = (() => {
  const NAME = 'receipt-app';
  const VERSION = 2;
  let db;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('receipts')) {
          const s = d.createObjectStore('receipts', { keyPath: 'id' });
          s.createIndex('date', 'date');
        }
        if (!d.objectStoreNames.contains('suppliers')) {
          d.createObjectStore('suppliers', { keyPath: 'name' });
        }
        if (!d.objectStoreNames.contains('photos')) {
          d.createObjectStore('photos', { keyPath: 'receiptId' }); // { receiptId, blob }
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function store(name, mode) {
    return db.transaction(name, mode).objectStore(name);
  }

  function put(name, value) {
    return new Promise((resolve, reject) => {
      const r = store(name, 'readwrite').put(value);
      r.onsuccess = () => resolve(value);
      r.onerror = (e) => reject(e.target.error);
    });
  }

  function getAll(name) {
    return new Promise((resolve, reject) => {
      const r = store(name, 'readonly').getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = (e) => reject(e.target.error);
    });
  }

  function get(name, key) {
    return new Promise((resolve, reject) => {
      const r = store(name, 'readonly').get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = (e) => reject(e.target.error);
    });
  }

  function remove(name, key) {
    return new Promise((resolve, reject) => {
      const r = store(name, 'readwrite').delete(key);
      r.onsuccess = () => resolve();
      r.onerror = (e) => reject(e.target.error);
    });
  }

  function clear(name) {
    return new Promise((resolve, reject) => {
      const r = store(name, 'readwrite').clear();
      r.onsuccess = () => resolve();
      r.onerror = (e) => reject(e.target.error);
    });
  }

  return { open, put, getAll, get, remove, clear };
})();
