// Vercel Serverless Function
// Routes:
//  GET    /api/notes            -> list all notes
//  POST   /api/notes            -> upsert {note}
//  DELETE /api/notes?id=<id>    -> soft delete (deleted:true)

let STORE = new Map(); // id -> note

export default async function handler(req, res) {
  // allow CORS if needed
  res.setHeader('Content-Type','application/json');

  if (req.method === 'GET') {
    const notes = Array.from(STORE.values());
    return res.status(200).json({ notes });
  }

  if (req.method === 'POST') {
    try {
      const { note } = req.body || {};
      if (!note || !note.id) return res.status(400).json({ error: 'Invalid note' });

      const prev = STORE.get(note.id);
      if (!prev || note.updatedAt >= (prev.updatedAt || 0)) {
        STORE.set(note.id, note);
      }
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(400).json({ error: 'Bad JSON' });
    }
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const prev = STORE.get(id);
    if (prev) {
      prev.deleted = true;
      prev.updatedAt = Date.now();
      STORE.set(id, prev);
    } else {
      // create a tombstone so other devices learn deletion
      STORE.set(id, { id, title: '', content: '', deleted: true, updatedAt: Date.now() });
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET,POST,DELETE');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
