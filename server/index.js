import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  initDb,
  listEntries,
  countEntries,
  getEntry,
  createEntry,
  updateEntry,
  deleteEntry,
  saveLinks,
  getRelated,
  getStats,
  rangeEntries,
  saveReport,
  getReport,
  addChat,
  listChats,
  clearChats,
  getSetting,
  setSetting,
  deleteSetting,
  storageMode,
  storageDetail,
} from './db.js';
import { enrichWithRules, rulesTodoPlan, rulesReport, tokens, splitConversations, firstLineOf } from './rules.js';
import {
  aiEnabled,
  model,
  enrichWithAI,
  answerWithAI,
  reportWithAI,
  todosPlanWithAI,
  setLlmConfig,
  getLlmInfo,
} from './ai.js';
import { authRequired, authMiddleware, issueToken, checkPassword, applyAuthConfig } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : path.resolve(__dirname, '..', 'dist');
const TZ = process.env.APP_TIMEZONE || 'Asia/Shanghai';
const VERSION = '1.0.1';

await initDb();

/* 令牌密钥与访问密码可从数据库加载（便于在网页里配置，重启不失效） */
if (!process.env.APP_SECRET) {
  let secret = await getSetting('app_secret');
  if (!secret) {
    secret = `${randomUUID()}${randomUUID()}`;
    await setSetting('app_secret', secret);
  }
  applyAuthConfig({ secret });
}
if (!process.env.APP_PASSWORD) {
  const dbPassword = await getSetting('app_password');
  if (dbPassword) applyAuthConfig({ password: dbPassword });
}

/* 数据库中的大模型配置作为环境变量的补充（环境变量优先） */
if (!process.env.OPENAI_API_KEY) {
  const dbKey = await getSetting('llm_api_key');
  if (dbKey) {
    setLlmConfig({
      apiKey: dbKey,
      baseUrl: (await getSetting('llm_base_url')) || '',
      model: (await getSetting('llm_model')) || '',
    });
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

/* ---------- 时区与日期工具 ---------- */
function tzParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
}

function localDate(d = new Date()) {
  const p = tzParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

function tzOffsetMs() {
  const now = new Date();
  const p = tzParts(now);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(now.getTime() / 1000) * 1000;
}

function utcFromLocal(dateStr, atEnd = false) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const midnightUtc = Date.UTC(y, m - 1, d);
  const ms = midnightUtc - tzOffsetMs() + (atEnd ? 86400000 - 1 : 0);
  return new Date(ms).toISOString();
}

function resolveRange({ period, from, to } = {}) {
  const now = new Date();
  const todayStr = localDate(now);
  if (from && to) {
    return { start: utcFromLocal(from), end: utcFromLocal(to, true), label: `${from} ~ ${to}` };
  }
  const labels = { today: '今日', week: '本周', month: '本月', days30: '近30天', all: '全部' };
  const p = labels[period] ? period : 'week';
  if (p === 'today') return { start: utcFromLocal(todayStr), end: utcFromLocal(todayStr, true), label: labels[p] };
  if (p === 'days30') {
    const startStr = localDate(new Date(now.getTime() - 29 * 86400000));
    return { start: utcFromLocal(startStr), end: utcFromLocal(todayStr, true), label: labels[p] };
  }
  if (p === 'all') {
    return {
      start: '1970-01-01T00:00:00.000Z',
      end: new Date(now.getTime() + 60000).toISOString(),
      label: labels[p],
    };
  }
  if (p === 'month') {
    const t = tzParts(now);
    return { start: utcFromLocal(`${t.year}-${t.month}-01`), end: utcFromLocal(todayStr, true), label: labels[p] };
  }
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(now);
  const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  const mondayStr = localDate(new Date(now.getTime() - ((idx + 6) % 7) * 86400000));
  return { start: utcFromLocal(mondayStr), end: utcFromLocal(todayStr, true), label: '本周' };
}

/* ---------- 公开接口 ---------- */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    version: VERSION,
    ai: aiEnabled,
    model: aiEnabled ? model : null,
    storageMode,
    storageDetail,
    auth: authRequired(),
    time: new Date().toISOString(),
  });
});

app.get('/api/auth/status', (req, res) => {
  res.json({ required: authRequired(), ai: aiEnabled, model: aiEnabled ? model : null, storage: storageMode });
});

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body || {};
  if (!authRequired()) return res.json({ token: null, note: '未启用访问密码' });
  if (!checkPassword(password)) return res.status(401).json({ error: '密码错误' });
  res.json({ token: issueToken() });
});

/* ---------- 受保护接口 ---------- */
app.use('/api', authMiddleware);

app.get('/api/settings/llm', (req, res) => {
  res.json(getLlmInfo());
});

app.post('/api/settings/llm', async (req, res, next) => {
  try {
    const { apiKey, baseUrl, model: modelName, clear } = req.body || {};
    if (clear) {
      await deleteSetting('llm_api_key');
      await deleteSetting('llm_base_url');
      await deleteSetting('llm_model');
    }
    if (typeof apiKey === 'string' && apiKey.trim()) await setSetting('llm_api_key', apiKey.trim());
    if (typeof baseUrl === 'string' && baseUrl.trim()) await setSetting('llm_base_url', baseUrl.trim());
    if (typeof modelName === 'string' && modelName.trim()) await setSetting('llm_model', modelName.trim());
    if (!process.env.OPENAI_API_KEY) {
      const effectiveKey = clear && !apiKey ? '' : (await getSetting('llm_api_key')) || '';
      setLlmConfig({
        apiKey: effectiveKey,
        baseUrl: (await getSetting('llm_base_url')) || '',
        model: (await getSetting('llm_model')) || '',
      });
    }
    res.json(getLlmInfo());
  } catch (e) {
    next(e);
  }
});

app.get('/api/settings/auth', (req, res) => {
  res.json({ required: authRequired() });
});

app.post('/api/settings/auth', async (req, res, next) => {
  try {
    const { password, clear } = req.body || {};
    if (clear) {
      await deleteSetting('app_password');
      applyAuthConfig({ password: '' });
    }
    if (typeof password === 'string' && password.trim()) {
      await setSetting('app_password', password.trim());
      applyAuthConfig({ password: password.trim() });
    }
    res.json({ required: authRequired() });
  } catch (e) {
    next(e);
  }
});

async function handleEntriesList(req, res) {
  const { q, type, category, status, from, to } = req.query;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const filter = { q, type, category, status, from, to };
  const [items, total] = await Promise.all([listEntries({ ...filter, limit, offset }), countEntries(filter)]);
  res.json({ items, total, limit, offset });
}

app.get('/api/entries', async (req, res, next) => {
  try {
    await handleEntriesList(req, res);
  } catch (e) {
    next(e);
  }
});

app.get('/api/search', async (req, res, next) => {
  try {
    if (!req.query.q) req.query.q = req.query.keyword;
    await handleEntriesList(req, res);
  } catch (e) {
    next(e);
  }
});

app.post('/api/entries', async (req, res, next) => {
  try {
    const body = req.body || {};
    const content = String(body.content || '').trim();
    if (!content) return res.status(400).json({ error: '内容不能为空' });
    const now = new Date().toISOString();
    const base = {
      id: randomUUID(),
      type: body.type && ['thought', 'todo', 'material', 'note'].includes(body.type) ? body.type : '',
      title: String(body.title || '').trim(),
      content,
      summary: '',
      category: String(body.category || '').trim(),
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 8) : [],
      status: 'open',
      priority: body.priority || 'medium',
      due_date: body.due_date || undefined,
      ai_processed: 0,
      created_at: now,
      updated_at: now,
    };
    const candidates = await listEntries({ limit: 15, offset: 0 });
    let enriched = null;
    if (aiEnabled) {
      try {
        enriched = await enrichWithAI(base, candidates);
      } catch (e) {
        console.error('[enrich] AI 整理失败，降级为规则模式：', e?.message);
      }
    }
    if (!enriched) enriched = enrichWithRules(base, candidates);
    const final = {
      ...base,
      type: enriched.type,
      title: enriched.title || base.title,
      summary: enriched.summary,
      category: enriched.category || '其他',
      tags: enriched.tags,
      priority: enriched.priority,
      due_date: enriched.due_date || null,
      ai_processed: enriched.fromAI ? 1 : 0,
    };
    await createEntry(final);
    const related = (enriched.related || []).slice(0, 8);
    if (related.length) await saveLinks(final.id, related);
    const saved = await getEntry(final.id);
    res.status(201).json({ entry: saved, related: await getRelated(final.id) });
  } catch (e) {
    next(e);
  }
});

app.get('/api/entries/:id', async (req, res, next) => {
  try {
    const entry = await getEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: '未找到该记录' });
    res.json({ entry, related: await getRelated(entry.id) });
  } catch (e) {
    next(e);
  }
});

app.patch('/api/entries/:id', async (req, res, next) => {
  try {
    const entry = await getEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: '未找到该记录' });
    const updated = await updateEntry(entry.id, req.body || {});
    res.json({ entry: updated });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/entries/:id', async (req, res, next) => {
  try {
    const entry = await getEntry(req.params.id);
    if (!entry) return res.status(404).json({ error: '未找到该记录' });
    await deleteEntry(entry.id);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.get('/api/todos', async (req, res, next) => {
  try {
    const items = await listEntries({ type: 'todo', limit: 500 });
    const today = localDate();
    const groups = [
      { key: 'overdue', label: '已逾期', items: [] },
      { key: 'today', label: '今天', items: [] },
      { key: 'upcoming', label: '待安排', items: [] },
      { key: 'done', label: '已完成', items: [] },
    ];
    for (const it of items) {
      if (it.status === 'done') groups[3].items.push(it);
      else if (it.due_date && it.due_date < today) groups[0].items.push(it);
      else if (it.due_date === today) groups[1].items.push(it);
      else groups[2].items.push(it);
    }
    for (const g of groups) {
      g.items.sort(
        (a, b) =>
          (b.priority === 'high') - (a.priority === 'high') ||
          (a.due_date || '9999').localeCompare(b.due_date || '9999') ||
          b.created_at.localeCompare(a.created_at),
      );
    }
    res.json({ groups, total: items.length, open: items.filter((i) => i.status === 'open').length });
  } catch (e) {
    next(e);
  }
});

app.post('/api/todos/plan', async (req, res, next) => {
  try {
    const todos = (await listEntries({ type: 'todo', limit: 500 })).filter((t) => t.status === 'open');
    if (!todos.length) {
      return res.json({
        title: '待办整理建议',
        markdown: '当前没有待办事项，去首页记录一些要做的事情吧。',
        ordered_ids: [],
      });
    }
    let payload = null;
    if (aiEnabled) {
      try {
        payload = await todosPlanWithAI(todos);
      } catch (e) {
        console.error('[plan] AI 待办整理失败，降级为规则模式：', e?.message);
      }
    }
    if (!payload) payload = rulesTodoPlan(todos, localDate());
    res.json(payload);
  } catch (e) {
    next(e);
  }
});

app.post('/api/ask', async (req, res, next) => {
  try {
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: '问题不能为空' });
    const keywordHits = await listEntries({ q: question, limit: 10 });
    const recents = await listEntries({ limit: 5 });
    const pool = [...keywordHits, ...recents.filter((r) => !keywordHits.some((h) => h.id === r.id))].slice(0, 10);
    let answer = '';
    let citationIds = [];
    let statsText = '';
    if (aiEnabled) {
      const s = await getStats();
      const byCat = Object.entries(s.byCategory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, v]) => `${k}:${v}`)
        .join('，');
      statsText = `资料库统计：共 ${s.total} 条记录；话题分布（条数）：${byCat || '暂无分类'}。`;
    }
    if (aiEnabled && pool.length) {
      const out = await answerWithAI(question, pool, statsText);
      answer = out.answer;
      citationIds = out.citations;
    } else if (aiEnabled) {
      answer = '当前还没有任何记录。先去首页记录一些想法、待办或资料，我就能基于它们回答你的问题。';
    } else {
      const qTokens = new Set(tokens(question));
      const related = pool.filter((e) => {
        const hay = `${e.title || ''} ${e.summary || ''} ${e.content || ''}`.toLowerCase();
        return [...qTokens].some((t) => hay.includes(t));
      });
      if (related.length) {
        const lines = related
          .slice(0, 4)
          .map((m, i) => `${i + 1}. 《${m.title || '无标题'}》：${(m.summary || m.content || '').slice(0, 80)}`);
        answer = `当前未配置大模型，我用关键词检索找到以下可能相关的内容：\n\n${lines.join('\n')}\n\n> 在服务端配置 OPENAI_API_KEY 后，即可获得基于全部记录的完整智能问答。`;
        citationIds = related.map((m) => m.id);
      } else {
        answer =
          '当前未配置大模型，本地记录中也没有找到明显相关的内容。请在服务端配置 OPENAI_API_KEY（或兼容服务）以启用智能问答。';
      }
    }
    await addChat('user', question);
    const citations = pool
      .filter((p) => citationIds.includes(p.id))
      .map((p) => ({ id: p.id, title: p.title || p.content.slice(0, 20), type: p.type }));
    await addChat('assistant', answer, citations);
    res.json({ answer, citations });
  } catch (e) {
    next(e);
  }
});

app.get('/api/chat/history', async (req, res, next) => {
  try {
    res.json({ messages: await listChats() });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/chat/history', async (req, res, next) => {
  try {
    await clearChats();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.get('/api/insights', async (req, res, next) => {
  try {
    const { kind = 'summary', from, to, period } = req.query;
    if (!['summary', 'keypoints', 'actions'].includes(kind)) {
      return res.status(400).json({ error: '不支持的报告类型' });
    }
    const range = resolveRange({ period, from, to });
    const fresh = req.query.fresh === '1';
    if (!fresh) {
      const cached = await getReport(kind, range.start, range.end);
      if (cached) {
        return res.json({
          kind,
          period: { start: range.start, end: range.end, label: range.label },
          ...cached,
          cached: true,
        });
      }
    }
    const entries = await rangeEntries(range.start, range.end);
    if (!entries.length) {
      return res.json({
        kind,
        period: { start: range.start, end: range.end, label: range.label },
        title: '暂无记录',
        markdown: '该时间段内还没有记录，先去记录一些内容吧。',
        cached: false,
      });
    }
    let payload = null;
    if (aiEnabled) {
      try {
        payload = await reportWithAI(kind, entries, range);
      } catch (e) {
        console.error('[insights] AI 生成失败，降级为规则模式：', e?.message);
      }
    }
    if (!payload) payload = rulesReport(kind, entries, range);
    await saveReport(kind, range.start, range.end, JSON.stringify(payload));
    res.json({
      kind,
      period: { start: range.start, end: range.end, label: range.label },
      ...payload,
      cached: false,
    });
  } catch (e) {
    next(e);
  }
});

app.get('/api/stats', async (req, res, next) => {
  try {
    res.json(await getStats());
  } catch (e) {
    next(e);
  }
});

app.post('/api/reprocess', async (req, res, next) => {
  try {
    if (!aiEnabled) return res.status(400).json({ error: '未配置大模型，无法进行智能整理' });
    const items = await listEntries({ limit: 500 });
    let done = 0;
    for (const e of items) {
      try {
        const candidates = items.filter((c) => c.id !== e.id).slice(0, 12);
        const enriched = await enrichWithAI(e, candidates);
        await updateEntry(e.id, {
          type: enriched.type,
          title: enriched.title || e.title,
          summary: enriched.summary,
          category: enriched.category,
          tags: enriched.tags,
          priority: enriched.priority,
          due_date: enriched.due_date,
          ai_processed: 1,
        });
        if (enriched.related?.length) await saveLinks(e.id, enriched.related.slice(0, 8));
        done += 1;
      } catch (err) {
        console.error('[reprocess] 整理失败：', e.id, err?.message);
      }
    }
    res.json({ done, total: items.length });
  } catch (e) {
    next(e);
  }
});

app.post('/api/import', async (req, res, next) => {
  try {
    const body = req.body || {};
    const source = String(body.source || 'DeepSeek').slice(0, 30);
    const dryRun = body.dryRun === true || req.query.dryRun === '1';
    let items = [];
    if (Array.isArray(body.items)) {
      items = body.items
        .filter((i) => i && (i.content || i.title || i.fields))
        .map((i) => ({
          title: String(i.title || i.fields?.title || '').slice(0, 60),
          content: String(i.content || ''),
          summary: String(i.summary || i.fields?.summary || '').slice(0, 200),
          category: String(i.category || i.fields?.category || '').slice(0, 20),
          tags: Array.isArray(i.tags) ? i.tags.slice(0, 5) : [],
          fields: i.fields && typeof i.fields === 'object' ? i.fields : null,
        }));
    } else if (typeof body.text === 'string' && body.text.trim()) {
      items = splitConversations(body.text).map((t) => ({ title: firstLineOf(t), content: t }));
    }
    if (!items.length) return res.status(400).json({ error: '没有可导入的内容' });
    if (dryRun) return res.json({ dryRun: true, count: Math.min(items.length, 500) });
    const buildConversationContent = (c) => {
      const lines = [`# ${c.title || '未命名对话'}`];
      if (c.category) lines.push(`分类：${c.category}${c.subcategory ? ` / ${c.subcategory}` : ''}`);
      if (c.created) lines.push(`时间：${c.created}${c.updated && c.updated !== c.created ? ` ~ ${c.updated}` : ''}`);
      if (c.user_intent) lines.push(`意图：${c.user_intent}`);
      const section = (heading, arr) => {
        if (Array.isArray(arr) && arr.length) {
          lines.push('', `## ${heading}`);
          arr.slice(0, 30).forEach((x) => lines.push(`- ${String(x).slice(0, 500)}`));
        }
      };
      section('问题', c.questions);
      section('要点', c.key_points);
      if (c.conclusion) lines.push('', '## 结论', String(c.conclusion).slice(0, 2000));
      section('建议', c.suggestions);
      if (Array.isArray(c.files) && c.files.length) {
        lines.push('', '## 附件');
        c.files.slice(0, 10).forEach((f) => lines.push(`- ${typeof f === 'string' ? f : JSON.stringify(f)}`));
      }
      return lines.join('\n');
    };
    let imported = 0;
    let skipped = 0;
    for (const it of items.slice(0, 500)) {
      const content = String(it.content || (it.fields ? buildConversationContent(it.fields) : '')).trim();
      if (!content) {
        skipped += 1;
        continue;
      }
      const now = new Date().toISOString();
      const base = {
        id: randomUUID(),
        type: 'material',
        title: it.title,
        content,
        summary: '',
        category: it.category,
        tags: ['对话', source, ...(it.fields?.category ? [it.fields.category] : []), ...it.tags],
        status: 'open',
        priority: 'medium',
        due_date: undefined,
        ai_processed: 0,
        created_at: now,
        updated_at: now,
      };
      const enriched = enrichWithRules(base, []);
      await createEntry({
        ...base,
        title: base.title || enriched.title,
        summary: it.summary || enriched.summary,
        category: it.category || enriched.category || '其他',
        tags: [...new Set([...base.tags, ...(enriched.tags || [])])].slice(0, 8),
      });
      imported += 1;
    }
    res.json({ imported, skipped, source });
  } catch (e) {
    next(e);
  }
});

/* ---------- 静态资源与兜底 ---------- */
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

app.use((err, req, res, next) => {
  console.error('[server] 未处理错误：', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '服务器开小差了，请稍后再试' });
});

const PORT = Number(process.env.PORT) || 8787;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🧠 个人信息管家已启动：http://127.0.0.1:${PORT}`);
  console.log(`   大模型：${aiEnabled ? `已连接（${model}）` : '未配置（规则模式）'}`);
  console.log(`   存储：${storageMode}（${storageDetail}）`);
  console.log(`   访问保护：${authRequired() ? '已启用' : '未启用'}`);
});
