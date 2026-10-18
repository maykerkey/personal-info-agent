import OpenAI from 'openai';

let apiKey = process.env.OPENAI_API_KEY || '';
let baseURL = process.env.OPENAI_BASE_URL || '';

export let aiEnabled = Boolean(apiKey);
export let model = process.env.OPENAI_MODEL || 'deepseek-chat';

let client = null;

function rebuild() {
  aiEnabled = Boolean(apiKey);
  client = aiEnabled
    ? new OpenAI({
        apiKey,
        ...(baseURL ? { baseURL } : {}),
      })
    : null;
}

rebuild();

export function setLlmConfig({ apiKey: k, baseUrl, model: m } = {}) {
  if (typeof k === 'string' && k.trim()) apiKey = k.trim();
  if (typeof baseUrl === 'string' && baseUrl.trim()) baseURL = baseUrl.trim();
  if (typeof m === 'string' && m.trim()) model = m.trim();
  rebuild();
}

export function getLlmInfo() {
  return {
    enabled: aiEnabled,
    model,
    baseUrl: baseURL || 'https://api.openai.com/v1',
    hasKey: Boolean(apiKey),
    keyTail: apiKey ? `••••••${apiKey.slice(-4)}` : '',
    source: process.env.OPENAI_API_KEY ? 'env' : apiKey ? 'db' : 'none',
  };
}

const CATEGORIES = ['工作', '学习', '生活', '健康', '财务', '想法', '资料', '其他'];
const TYPE_LABEL = { thought: '想法', todo: '待办', material: '资料', note: '记录' };

async function chatJSON(system, user, { temperature = 0.2 } = {}) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  let text = '';
  try {
    const res = await client.chat.completions.create({
      model,
      temperature,
      messages,
      response_format: { type: 'json_object' },
    });
    text = res.choices?.[0]?.message?.content || '';
  } catch (err) {
    // 部分兼容服务不支持 JSON 输出模式，去掉该参数重试一次
    console.warn('[ai] json_object 模式失败，改用普通模式重试：', err?.message);
    const res = await client.chat.completions.create({
      model,
      temperature,
      messages,
    });
    text = res.choices?.[0]?.message?.content || '';
  }
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* 落到 null */
      }
    }
    return null;
  }
}

function fixType(v) {
  const map = {
    thought: 'thought',
    todo: 'todo',
    material: 'material',
    note: 'note',
    想法: 'thought',
    灵感: 'thought',
    待办: 'todo',
    资料: 'material',
    记录: 'note',
  };
  return map[v] || 'note';
}

export async function enrichWithAI(entry, candidates = []) {
  const cand = candidates
    .filter((c) => c.id !== entry.id)
    .slice(0, 12)
    .map((c) => ({
      id: c.id,
      title: c.title || c.content.slice(0, 20),
      type: c.type,
      category: c.category,
      summary: (c.summary || c.content || '').slice(0, 120),
    }));
  const system = `你是「个人信息管家」的智能整理引擎。用户会输入一条新的个人记录（想法、待办或资料），你需要：
1. 判断类型 type：thought（想法/灵感）、todo（待办）、material（资料）、note（普通记录）
2. 生成简洁标题 title（不超过 20 字；待办用动词开头）
3. 生成一句话摘要 summary（不超过 60 字，保留关键信息）
4. 从候选分类中选择或创建 category
5. 提取 2-6 个标签 tags（不要带 # 号）
6. 判断优先级 priority：low / medium / high
7. 若为待办且能判断截止时间，给出 due_date（YYYY-MM-DD），否则为 null
8. 从 candidates 中挑选与当前记录真正相关（主题、人物、项目、上下文相关）的记录，输出 related 数组 [{id, reason}]，reason 不超过 20 字；没有相关记录则输出空数组
只输出 JSON，不要输出任何其他内容。输出格式：
{"type":"thought","title":"...","summary":"...","category":"工作","tags":["..."],"priority":"medium","due_date":null,"related":[{"id":"...","reason":"..."}]}`;
  const user = JSON.stringify({
    entry: {
      type: entry.type,
      title: entry.title,
      content: entry.content,
      category: entry.category,
      tags: entry.tags,
    },
    categories: CATEGORIES,
    candidates: cand,
  });
  const out = await chatJSON(system, user);
  if (!out) throw new Error('AI 输出解析失败');
  const tags = Array.isArray(out.tags)
    ? out.tags.filter((t) => typeof t === 'string' && t.trim()).slice(0, 8).map((t) => t.replace(/^#/, ''))
    : [];
  const related = Array.isArray(out.related)
    ? out.related
        .filter((r) => r && r.id && cand.some((c) => c.id === r.id))
        .map((r) => ({ relatedId: r.id, reason: String(r.reason || '').slice(0, 200), score: 1 }))
    : [];
  const due = /^\d{4}-\d{2}-\d{2}$/.test(out.due_date || '') ? out.due_date : undefined;
  return {
    type: fixType(out.type || entry.type),
    title: String(out.title || '').slice(0, 60),
    summary: String(out.summary || '').slice(0, 200),
    category: typeof out.category === 'string' ? out.category || '其他' : '其他',
    tags,
    priority: ['low', 'medium', 'high'].includes(out.priority) ? out.priority : 'medium',
    due_date: due,
    related,
    fromAI: true,
  };
}

export async function answerWithAI(question, ctxEntries = [], statsText = '') {
  const ctxList = ctxEntries
    .map(
      (e, i) =>
        `【${i + 1}】标题：${e.title || '无标题'}\n类型：${TYPE_LABEL[e.type] || e.type}｜分类：${e.category || '其他'}\n内容：${(e.content || '').slice(0, 1200)}`,
    )
    .join('\n\n');
  const system = `你是「个人信息管家」的智能助手，负责基于用户自己的记录回答问题。
规则：
- 只能依据「资料」中的内容回答，禁止编造或补充外部知识
- 引用资料时在句末标注来源编号，如【1】【2】
- 如果资料不足以回答，直接说明"根据现有记录无法回答"，并指出可能相关的方向
- 回答简洁、条理清晰，可使用 markdown
- 优先使用与问题最相关的资料
只输出 JSON：{"answer":"回答内容","citations":[1,2]}`;
  const out = await chatJSON(
    system,
    `资料：\n${statsText ? `${statsText}\n\n` : ''}${ctxList || '（暂无资料）'}\n\n用户问题：${question}`,
    { temperature: 0.3 },
  );
  if (!out) throw new Error('AI 输出解析失败');
  const citations = Array.isArray(out.citations)
    ? out.citations
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= ctxEntries.length)
        .map((n) => ctxEntries[n - 1]?.id)
        .filter(Boolean)
    : [];
  return { answer: String(out.answer || ''), citations };
}

function buildStatsText(entries) {
  const byType = {};
  const byCat = {};
  for (const e of entries) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    byCat[e.category] = (byCat[e.category] || 0) + 1;
  }
  const fmt = (obj) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${TYPE_LABEL[k] || k}:${v}`)
      .join('，');
  const openTodos = entries.filter((e) => e.type === 'todo' && e.status === 'open').length;
  const doneTodos = entries.filter((e) => e.type === 'todo' && e.status === 'done').length;
  return `记录总数：${entries.length}\n类型分布：${fmt(byType)}\n分类分布：${fmt(byCat)}\n待办：${openTodos} 项未完成，${doneTodos} 项已完成`;
}

export async function reportWithAI(kind, entries, range) {
  const label = range.label || '';
  const stats = buildStatsText(entries);
  const list = entries
    .slice(0, 80)
    .map(
      (e, i) =>
        `${i + 1}. [${TYPE_LABEL[e.type] || e.type}｜${e.category || '其他'}] ${e.title || '(无标题)'}（${(e.created_at || '').slice(0, 10)}）\n   摘要：${(e.summary || e.content || '').slice(0, 100)}`,
    )
    .join('\n');
  const tasks = {
    summary:
      '请生成一份结构清晰的「阶段总结」markdown，包含：总体概览、分类与主题分布、待办完成情况、重点内容回顾、值得注意的趋势或问题。',
    keypoints:
      '请从这些记录中提取「重点信息」，markdown 输出：关键要点（每条一行）、重要日期与截止时间、需要关注的事项。',
    actions:
      '请基于这些记录生成「后续行动建议」，markdown 输出：待办清单（- [ ] 格式）、分优先级的行动建议、给用户的具体提醒。',
  };
  const system = `你是「个人信息管家」的复盘引擎，基于用户一段时间内的个人记录生成复盘内容。
只输出 JSON：{"title":"报告标题","markdown":"报告正文"}。markdown 使用中文，结构清晰、直接可用。`;
  const out = await chatJSON(
    system,
    `时间段：${label}\n\n${stats}\n\n记录列表：\n${list}\n\n任务：${tasks[kind] || tasks.summary}`,
  );
  if (!out) throw new Error('AI 输出解析失败');
  const fallbackTitle =
    kind === 'summary'
      ? `阶段总结（${label}）`
      : kind === 'keypoints'
        ? `重点信息提取（${label}）`
        : `后续行动建议（${label}）`;
  return { title: String(out.title || fallbackTitle), markdown: String(out.markdown || '') };
}

export async function todosPlanWithAI(todos) {
  const list = todos.map((t) => ({
    id: t.id,
    title: t.title || t.content.slice(0, 30),
    priority: t.priority,
    due_date: t.due_date || null,
    category: t.category,
    created_at: (t.created_at || '').slice(0, 10),
  }));
  const system = `你是「个人信息管家」的待办整理助手。根据待办的紧急程度、截止时间、优先级和内容关联，给出：
1. markdown：简洁的整理说明与建议（分优先级、指出逾期项和可以合并/拆分的事项）
2. ordered_ids：按建议处理顺序排列的全部待办 id
只输出 JSON：{"title":"...","markdown":"...","ordered_ids":["..."]}`;
  const out = await chatJSON(system, `待办列表：\n${JSON.stringify(list, null, 2)}`);
  if (!out) throw new Error('AI 输出解析失败');
  const ids = new Set(todos.map((t) => t.id));
  const ordered_ids = Array.isArray(out.ordered_ids) ? out.ordered_ids.filter((id) => ids.has(id)) : [];
  for (const t of todos) if (!ordered_ids.includes(t.id)) ordered_ids.push(t.id);
  return { title: out.title || '待办整理建议', markdown: String(out.markdown || ''), ordered_ids };
}
