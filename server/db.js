import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

const rawUrl = process.env.DATABASE_URL || 'file:data/info.db';
const isLocal = rawUrl.startsWith('file:');

if (isLocal) {
  const filePath = rawUrl.slice('file:'.length);
  if (filePath && !filePath.includes(':memory:')) {
    fs.mkdirSync(path.dirname(path.resolve(filePath)) || '.', { recursive: true });
  }
}

export const db = createClient({
  url: rawUrl,
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

export const storageMode = isLocal ? '本地文件存储' : '云端数据库';
export const storageDetail = isLocal
  ? rawUrl
  : rawUrl.replace(/\/\/[^@]+@/, '//***@');

export async function initDb() {
  if (isLocal) {
    try {
      // 本地文件使用回滚日志（DELETE）：数据始终在单一 .db 文件中，强制关机/断电也不会丢失
      await db.execute('PRAGMA journal_mode = DELETE;');
    } catch {
      /* 忽略 */
    }
  }
  await db.execute(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'note',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '其他',
      tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'medium',
      due_date TEXT,
      ai_processed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at DESC);');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);');
  await db.execute(`
    CREATE TABLE IF NOT EXISTS links (
      entry_id TEXT NOT NULL,
      related_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      score REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (entry_id, related_id)
    );`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );`);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );`);
}

const safeParseArray = (s) => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const rowToEntry = (r) => ({ ...r, tags: safeParseArray(r.tags) });

function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (m) => `\\${m}`);
}

function buildFilter({ q, type, category, status, from, to } = {}) {
  const conds = [];
  const args = [];
  if (q && String(q).trim()) {
    const like = `%${escapeLike(String(q).trim())}%`;
    conds.push(
      `(e.title LIKE ? ESCAPE '\\' OR e.content LIKE ? ESCAPE '\\' OR e.summary LIKE ? ESCAPE '\\' OR e.tags LIKE ? ESCAPE '\\')`,
    );
    args.push(like, like, like, like);
  }
  if (type) {
    conds.push('e.type = ?');
    args.push(type);
  }
  if (category) {
    conds.push('e.category = ?');
    args.push(category);
  }
  if (status) {
    conds.push('e.status = ?');
    args.push(status);
  }
  if (from) {
    conds.push('e.created_at >= ?');
    args.push(from);
  }
  if (to) {
    conds.push('e.created_at < ?');
    args.push(to);
  }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', args };
}

export async function listEntries({ q, type, category, status, from, to, limit = 50, offset = 0 } = {}) {
  const { where, args } = buildFilter({ q, type, category, status, from, to });
  const res = await db.execute({
    sql: `SELECT e.*, (SELECT COUNT(*) FROM links l WHERE l.entry_id = e.id) AS related_count
          FROM entries e ${where}
          ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  });
  return res.rows.map(rowToEntry);
}

export async function countEntries(filter = {}) {
  const { where, args } = buildFilter(filter);
  const res = await db.execute({ sql: `SELECT COUNT(*) AS c FROM entries e ${where}`, args });
  return res.rows[0]?.c ?? 0;
}

export async function getEntry(id) {
  const res = await db.execute({
    sql: `SELECT e.*, (SELECT COUNT(*) FROM links l WHERE l.entry_id = e.id) AS related_count
          FROM entries e WHERE e.id = ?`,
    args: [id],
  });
  return res.rows[0] ? rowToEntry(res.rows[0]) : null;
}

export async function createEntry(e) {
  await db.execute({
    sql: `INSERT INTO entries
          (id, type, title, content, summary, category, tags, status, priority, due_date, ai_processed, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      e.id,
      e.type,
      e.title,
      e.content,
      e.summary,
      e.category,
      JSON.stringify(e.tags || []),
      e.status,
      e.priority,
      e.due_date || null,
      e.ai_processed ? 1 : 0,
      e.created_at,
      e.updated_at,
    ],
  });
  return getEntry(e.id);
}

const PATCH_FIELDS = new Set([
  'type',
  'title',
  'content',
  'summary',
  'category',
  'priority',
  'due_date',
  'status',
]);

export async function updateEntry(id, patch = {}) {
  const sets = [];
  const args = [];
  for (const [k, v] of Object.entries(patch)) {
    if (PATCH_FIELDS.has(k)) {
      sets.push(`${k} = ?`);
      args.push(k === 'due_date' ? v || null : v);
    } else if (k === 'tags') {
      sets.push('tags = ?');
      args.push(JSON.stringify(v || []));
    } else if (k === 'ai_processed') {
      sets.push('ai_processed = ?');
      args.push(v ? 1 : 0);
    }
  }
  if (!sets.length) return getEntry(id);
  sets.push('updated_at = ?');
  args.push(new Date().toISOString());
  await db.execute({ sql: `UPDATE entries SET ${sets.join(', ')} WHERE id = ?`, args: [...args, id] });
  return getEntry(id);
}

export async function deleteEntry(id) {
  await db.execute({ sql: 'DELETE FROM links WHERE entry_id = ? OR related_id = ?', args: [id, id] });
  await db.execute({ sql: 'DELETE FROM entries WHERE id = ?', args: [id] });
}

export async function saveLinks(entryId, rels = []) {
  for (const r of rels) {
    if (!r || !r.relatedId || r.relatedId === entryId) continue;
    for (const [a, b] of [
      [entryId, r.relatedId],
      [r.relatedId, entryId],
    ]) {
      try {
        await db.execute({
          sql: `INSERT OR REPLACE INTO links (entry_id, related_id, reason, score) VALUES (?, ?, ?, ?)`,
          args: [a, b, String(r.reason || '').slice(0, 200), Number(r.score) || 0],
        });
      } catch {
        /* 目标记录可能已被删除，忽略 */
      }
    }
  }
}

export async function getRelated(id) {
  const res = await db.execute({
    sql: `SELECT l.related_id AS id, l.reason, l.score,
                 e.title, e.type, e.category, e.summary, e.created_at
          FROM links l JOIN entries e ON e.id = l.related_id
          WHERE l.entry_id = ?
          ORDER BY l.score DESC, e.created_at DESC LIMIT 20`,
    args: [id],
  });
  return res.rows;
}

export async function rangeEntries(fromIso, toIso) {
  const res = await db.execute({
    sql: `SELECT * FROM entries WHERE created_at >= ? AND created_at < ? ORDER BY created_at ASC`,
    args: [fromIso, toIso],
  });
  return res.rows.map(rowToEntry);
}

export async function getStats() {
  const one = async (sql, args = []) => {
    const r = await db.execute({ sql, args });
    return r.rows[0]?.c ?? 0;
  };
  const total = await one('SELECT COUNT(*) AS c FROM entries');
  const openTodos = await one(`SELECT COUNT(*) AS c FROM entries WHERE type = 'todo' AND status = 'open'`);
  const doneTodos = await one(`SELECT COUNT(*) AS c FROM entries WHERE type = 'todo' AND status = 'done'`);
  const byTypeRows = await db.execute('SELECT type, COUNT(*) AS c FROM entries GROUP BY type');
  const byCategoryRows = await db.execute('SELECT category, COUNT(*) AS c FROM entries GROUP BY category');
  const byType = {};
  for (const r of byTypeRows.rows) byType[r.type] = r.c;
  const byCategory = {};
  for (const r of byCategoryRows.rows) byCategory[r.category] = r.c;
  return { total, openTodos, doneTodos, byType, byCategory };
}

export async function saveReport(kind, start, end, content) {
  await db.execute({
    sql: `INSERT OR REPLACE INTO reports (id, kind, period_start, period_end, content, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [`${kind}|${start || ''}|${end || ''}`, kind, start || null, end || null, content, new Date().toISOString()],
  });
}

export async function getReport(kind, start, end) {
  const res = await db.execute({
    sql: `SELECT * FROM reports WHERE kind = ? AND period_start = ? AND period_end = ?`,
    args: [kind, start || null, end || null],
  });
  const row = res.rows[0];
  if (!row) return null;
  try {
    return JSON.parse(row.content);
  } catch {
    return { title: '', markdown: row.content };
  }
}

export async function addChat(role, content, citations = []) {
  await db.execute({
    sql: `INSERT INTO chats (role, content, citations, created_at) VALUES (?, ?, ?, ?)`,
    args: [role, content, JSON.stringify(citations || []), new Date().toISOString()],
  });
}

export async function listChats(limit = 200) {
  const res = await db.execute({
    sql: `SELECT id, role, content, citations, created_at FROM chats ORDER BY id ASC LIMIT ?`,
    args: [limit],
  });
  return res.rows.map((r) => ({ ...r, citations: safeParseArray(r.citations) }));
}

export async function clearChats() {
  await db.execute('DELETE FROM chats;');
}

export async function getSetting(key) {
  const res = await db.execute({ sql: 'SELECT value FROM settings WHERE key = ?', args: [key] });
  return res.rows[0]?.value ?? null;
}

export async function setSetting(key, value) {
  await db.execute({
    sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    args: [key, String(value ?? '')],
  });
}

export async function deleteSetting(key) {
  await db.execute({ sql: 'DELETE FROM settings WHERE key = ?', args: [key] });
}
