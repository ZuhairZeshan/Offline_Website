// ---------- tiny utils ----------
const $ = (s) => document.querySelector(s);
const tpl = (id) => document.getElementById(id).content.firstElementChild.cloneNode(true);
const uid = () => crypto.randomUUID();

// ---------- network status UI ----------
const netBadge = $('#netStatus');
const syncBadge = $('#syncStatus');
function setOnlineUI() { netBadge.textContent = 'Online'; netBadge.classList.remove('offline'); }
function setOfflineUI() { netBadge.textContent = 'Offline'; netBadge.classList.add('offline'); }
window.addEventListener('online', () => { setOnlineUI(); processQueue(); fetchAndMergeServerNotes(); });
window.addEventListener('offline', setOfflineUI);
if (navigator.onLine) setOnlineUI(); else setOfflineUI();

// ---------- IndexedDB setup ----------
const DB_NAME = 'offline-notes-db';
const DB_VER = 1;
let db;

const openDB = () => new Promise((res, rej) => {
  const req = indexedDB.open(DB_NAME, DB_VER);
  req.onupgradeneeded = () => {
    const d = req.result;
    if (!d.objectStoreNames.contains('notes')) {
      const notes = d.createObjectStore('notes', { keyPath: 'id' });
      notes.createIndex('updatedAt', 'updatedAt');
    }
    if (!d.objectStoreNames.contains('queue')) {
      d.createObjectStore('queue', { keyPath: 'qid' }); // {qid, op, note}
    }
  };
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

async function tx(store, mode='readonly') {
  if (!db) db = await openDB();
  return db.transaction(store, mode).objectStore(store);
}

async function putNote(note) {
  const store = await tx('notes', 'readwrite');
  return reqWrap(store.put(note));
}
async function getAllNotes() {
  const store = await tx('notes');
  return reqAll(store);
}
async function deleteNoteLocal(id) {
  const store = await tx('notes', 'readwrite');
  return reqWrap(store.delete(id));
}
async function enqueue(op, note) {
  const store = await tx('queue', 'readwrite');
  return reqWrap(store.put({ qid: uid(), op, note }));
}
async function getQueue() {
  const store = await tx('queue');
  return reqAll(store);
}
async function clearQueueIds(qids) {
  const store = await tx('queue', 'readwrite');
  await Promise.all(qids.map(qid => reqWrap(store.delete(qid))));
}
function reqWrap(req) { return new Promise((res, rej) => { req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
function reqAll(store) { return new Promise((res, rej) => {
  const out=[]; const cursorReq = store.openCursor();
  cursorReq.onsuccess = e => { const c = e.target.result; if (c) { out.push(c.value); c.continue(); } else res(out); };
  cursorReq.onerror = () => rej(cursorReq.error);
}); }

// ---------- UI state ----------
const titleEl = $('#noteTitle');
const contentEl = $('#noteContent');
const saveBtn = $('#saveBtn');
const clearBtn = $('#clearBtn');
const listEl = $('#notesList');

let editingId = null;

// Render list
async function renderList() {
  const notes = await getAllNotes();
  notes.sort((a,b) => b.updatedAt - a.updatedAt);
  listEl.innerHTML = '';
  for (const n of notes) {
    if (n.deleted) continue;
    const li = tpl('noteItemTpl');
    li.querySelector('.title').textContent = n.title || '(No title)';
    li.querySelector('.time').textContent = new Date(n.updatedAt).toLocaleString();
    li.querySelector('.edit').onclick = () => {
      editingId = n.id;
      titleEl.value = n.title || '';
      contentEl.value = n.content || '';
      titleEl.focus();
    };
    li.querySelector('.delete').onclick = () => deleteNote(n.id);
    listEl.appendChild(li);
  }
}

// Save / Update
saveBtn.addEventListener('click', async () => {
  const now = Date.now();
  const base = {
    id: editingId || uid(),
    title: titleEl.value.trim(),
    content: contentEl.value.trim(),
    updatedAt: now,
    deleted: false
  };
  await putNote(base);

  // queue operation
  await enqueue(editingId ? 'update' : 'create', base);
  bumpSync('Queued');

  // try processing
  if (navigator.onLine) processQueue();

  // reset UI
  editingId = null;
  titleEl.value = '';
  contentEl.value = '';
  await renderList();
});

clearBtn.addEventListener('click', () => {
  editingId = null;
  titleEl.value = '';
  contentEl.value = '';
});

async function deleteNote(id) {
  // soft delete locally (so we keep updatedAt for sync resolution)
  const existing = (await getAllNotes()).find(n => n.id === id);
  if (!existing) return;
  existing.deleted = true;
  existing.updatedAt = Date.now();
  await putNote(existing);
  await enqueue('delete', { id });
  bumpSync('Queued');
  if (navigator.onLine) processQueue();
  await renderList();
}

// ---------- Sync layer ----------
function bumpSync(text) { syncBadge.textContent = text; }

async function processQueue() {
  if (!navigator.onLine) return;
  const queue = await getQueue();
  if (!queue.length) { bumpSync('Idle'); return; }

  bumpSync(`Syncing ${queue.length}…`);
  const qidsToClear = [];

  for (const item of queue) {
    try {
      if (item.op === 'create' || item.op === 'update') {
        await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: item.note })
        });
      } else if (item.op === 'delete') {
        await fetch('/api/notes?id=' + encodeURIComponent(item.note.id), {
          method: 'DELETE'
        });
      }
      qidsToClear.push(item.qid);
    } catch (e) {
      // leave in queue; network might be flaky
    }
  }

  if (qidsToClear.length) await clearQueueIds(qidsToClear);
  bumpSync('Synced');
  // Pull server copy and merge (handles multi-device later)
  await fetchAndMergeServerNotes();
  await renderList();
}

async function fetchAndMergeServerNotes() {
  if (!navigator.onLine) return;
  try {
    const res = await fetch('/api/notes');
    const { notes: serverNotes } = await res.json();

    // 3-way: if server newer -> overwrite local; if local newer -> it’ll be pushed next edit
    const local = await getAllNotes();
    const localMap = new Map(local.map(n => [n.id, n]));
    for (const s of serverNotes) {
      const l = localMap.get(s.id);
      if (!l || (s.updatedAt > l.updatedAt)) {
        await putNote(s);
      }
    }
  } catch (_) {}
}

// initial boot
(async function boot() {
  db = await openDB();
  await renderList();
  // attempt initial sync and merge
  if (navigator.onLine) { await processQueue(); await fetchAndMergeServerNotes(); await renderList(); }
})();
