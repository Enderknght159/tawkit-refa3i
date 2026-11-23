/* ==========================================================================
   مخزن الإعلانات — IndexedDB
   يحفظ صور الإعلانات داخل جهاز العرض، ويقرأ أيضاً قائمة اختيارية من
   assets/ads/manifest.json لمن يفضّل نسخ الصور إلى المجلد مباشرة.
   ========================================================================== */

(function () {
  'use strict';

  const DB_NAME = 'rifa3i-ads';
  const STORE = 'ads';
  const MAX_EDGE = 2400;
  const QUALITY = 0.9;

  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('no-indexeddb')); return; }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('order', 'order');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  function tx(mode) {
    return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
  }

  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'ad-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad-image')); };
      img.src = url;
    });
  }

  async function prepare(file) {
    let source = null;
    let width = 0;
    let height = 0;

    if ('createImageBitmap' in window) {
      try {
        source = await createImageBitmap(file);
        width = source.width;
        height = source.height;
      } catch (e) { source = null; }
    }
    if (!source) {
      source = await loadImage(file);
      width = source.naturalWidth || source.width;
      height = source.naturalHeight || source.height;
    }

    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f4efe9';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    if (source.close) source.close();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    return { blob: blob || file, width: w, height: h };
  }

  async function all() {
    try {
      const store = await tx('readonly');
      const rows = await wrap(store.getAll());
      return rows.sort((a, b) => (a.order || 0) - (b.order || 0));
    } catch (e) {
      return [];
    }
  }

  async function addFiles(files) {
    const list = Array.from(files || []).filter((f) => /^image\//.test(f.type));
    if (!list.length) return 0;

    // آخر ترتيب مستعمل
    const existing = await all();
    let order = existing.reduce((max, row) => Math.max(max, row.order || 0), 0);

    // تجهيز الصور خارج المعاملة (المعاملة تنتهي إذا انتظرنا بين الطلبات)
    const records = [];
    for (const file of list) {
      try {
        const prepared = await prepare(file);
        order += 1;
        records.push({
          id: uid(),
          name: file.name || 'إعلان',
          blob: prepared.blob,
          width: prepared.width,
          height: prepared.height,
          bytes: prepared.blob.size,
          order,
          addedAt: Date.now(),
        });
      } catch (e) {
        console.warn('تعذّر تجهيز الصورة', file && file.name, e);
      }
    }

    if (!records.length) return 0;

    try {
      const store = await tx('readwrite');
      for (const record of records) store.put(record);
      return records.length;
    } catch (e) {
      console.warn('تعذّر حفظ الصور', e);
      return 0;
    }
  }

  async function remove(id) {
    try {
      const store = await tx('readwrite');
      await wrap(store.delete(id));
      return true;
    } catch (e) {
      return false;
    }
  }

  async function move(id, direction) {
    try {
      const rows = await all();
      const index = rows.findIndex((row) => row.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= rows.length) return false;
      const store = await tx('readwrite');
      const a = rows[index];
      const b = rows[target];
      store.put({ ...a, order: b.order });
      store.put({ ...b, order: a.order });
      return true;
    } catch (e) {
      return false;
    }
  }

  async function clear() {
    try {
      const store = await tx('readwrite');
      await wrap(store.clear());
      return true;
    } catch (e) {
      return false;
    }
  }

  async function manifest() {
    try {
      const response = await fetch('assets/ads/manifest.json', { cache: 'no-store' });
      if (!response.ok) return [];
      const data = await response.json();
      const items = Array.isArray(data) ? data : (data && data.ads) || [];
      return items
        .filter((item) => item && (typeof item === 'string' || item.src))
        .map((item, index) => {
          const src = typeof item === 'string' ? item : item.src;
          const name = typeof item === 'string'
            ? src.split('/').pop()
            : (item.title || src.split('/').pop());
          return {
            id: 'file:' + src,
            name,
            src: new URL(src, document.baseURI).href,
            kind: 'file',
            order: 100000 + index,
          };
        });
    } catch (e) {
      return [];
    }
  }

  window.AdsStore = { all, addFiles, remove, move, clear, manifest, isSupported: () => 'indexedDB' in window };
})();
