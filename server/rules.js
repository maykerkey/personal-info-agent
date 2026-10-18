const STOP_WORDS = new Set(
  '的了和是就在我你他她它们有也便都而及与这那个不很把被让对从到为说着过还又之吗呢吧啊哦嗯什么怎么一个我们你们一些自己可以没有但是因为所以如果已经然后现在时候就是这些那些这样知道觉得需要想要进行关于还有只是时候应该',
);

export const CATEGORIES = ['工作', '学习', '生活', '健康', '财务', '想法', '资料', '其他'];

const TYPE_RULES = [
  {
    type: 'todo',
    re: /(要记得|需要|打算|准备|计划|安排|别忘了|尽快|抽空|去做|记得|待办|买|订|预约|提交|完成|跟进|回复|交|写一份)/,
  },
  {
    type: 'thought',
    re: /(想法|灵感|思考|觉得|感悟|反思|为什么|怎么|如何|也许|可能|应该|？|\?)/,
  },
];

const URL_RE = /https?:\/\/\S+/i;

const CATEGORY_RULES = [
  ['工作', /(工作|项目|会议|同事|客户|报告|方案|代码|上线|需求|周报|老板|邮件|职场|面试|招聘|产品)/],
  ['学习', /(学习|读书|阅读|课程|笔记|考试|论文|知识|技能|英语|单词|教程|研究)/],
  ['生活', /(生活|家|吃|做饭|购物|旅行|健身|运动|家务|宠物|朋友|聚会|礼物|装修|出行)/],
  ['健康', /(健康|身体|睡眠|体检|吃药|医院|锻炼|减肥|饮食|养生|感冒|不舒服)/],
  ['财务', /(钱|财务|预算|理财|投资|基金|股票|账单|还款|收入|支出|省钱|工资)/],
  ['想法', /(想法|灵感|点子|创意|感悟|思考)/],
  ['资料', /(资料|链接|文章|文档|收藏|网址|http)/],
];

export function detectType(content) {
  const text = content || '';
  if (URL_RE.test(text)) return 'material';
  for (const rule of TYPE_RULES) {
    if (rule.re.test(text)) return rule.type;
  }
  if (text.length > 160) return 'material';
  return 'note';
}

export function classifyCategory(content) {
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(content || '')) return cat;
  }
  return '其他';
}

export function extractTags(content) {
  const tags = [];
  const re = /#([\p{L}\p{N}_-]{1,20})/gu;
  let m;
  while ((m = re.exec(content || ''))) tags.push(m[1]);
  return [...new Set(tags)];
}

export function summarize(content) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (text.length <= 90) return text;
  return `${text.slice(0, 90)}…`;
}

export function autoTitle(content) {
  const first = String(content || '').split('\n').find((l) => l.trim());
  const text = (first || '').replace(/^#+\s*/, '').trim();
  if (!text) return '';
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

export function dueFromText(content, todayStr) {
  const text = content || '';
  const m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const mm = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (mm) {
    const year = todayStr ? Number(todayStr.slice(0, 4)) : new Date().getFullYear();
    return `${year}-${mm[1].padStart(2, '0')}-${mm[2].padStart(2, '0')}`;
  }
  if (/(后天|大后天)/.test(text) || /(今天|明天)/.test(text)) {
    const base = todayStr ? new Date(`${todayStr}T00:00:00`) : new Date();
    let offset = 0;
    if (/明天/.test(text)) offset = 1;
    if (/后天/.test(text)) offset = 2;
    if (/大后天/.test(text)) offset = 3;
    base.setDate(base.getDate() + offset);
    return base.toLocaleDateString('en-CA');
  }
  return undefined;
}

export function tokens(text) {
  const found = [];
  const re = /[\u4e00-\u9fff]{2,}|[a-zA-Z][a-zA-Z0-9_-]{1,}/g;
  let m;
  while ((m = re.exec(String(text || '').toLowerCase()))) {
    const w = m[0];
    if (/^[\u4e00-\u9fff]+$/.test(w)) {
      if (w.length <= 12) found.push(w);
      for (let i = 0; i + 2 <= w.length; i++) {
        const big = w.slice(i, i + 2);
        if (!STOP_WORDS.has(big)) found.push(big);
      }
    } else if (!STOP_WORDS.has(w) && w.length <= 12) {
      found.push(w);
    }
  }
  return [...new Set(found)];
}

export function overlapScore(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t));
  return shared.length / (ta.length + tb.length - shared.length);
}

export function suggestRelated(entry, candidates = []) {
  const rels = [];
  const content = `${entry.title || ''} ${entry.content || ''}`;
  for (const c of candidates) {
    if (c.id === entry.id) continue;
    const other = `${c.title || ''} ${c.summary || ''} ${c.content || ''}`;
    const score = overlapScore(content, other);
    const cTokens = tokens(other);
    const shared = tokens(content).filter((t) => cTokens.includes(t));
    if (score >= 0.12 || shared.length >= 2) {
      rels.push({
        relatedId: c.id,
        reason: shared.length ? `共同关键词：${shared.slice(0, 3).join('、')}` : '内容相关',
        score: Math.round(score * 100) / 100,
      });
    }
  }
  return rels.sort((a, b) => b.score - a.score).slice(0, 6);
}

export function enrichWithRules(entry, candidates = []) {
  const type = entry.type && entry.type !== 'note' ? entry.type : detectType(entry.content);
  const category =
    entry.category ||
    (type === 'thought' && /(想法|灵感|点子|创意|感悟|思考)/.test(entry.content || '')
      ? '想法'
      : classifyCategory(entry.content));
  const tags = [...new Set([...(entry.tags || []), ...extractTags(entry.content)])].slice(0, 8);
  const summary = summarize(entry.content);
  const due = type === 'todo' ? entry.due_date || dueFromText(entry.content) : entry.due_date;
  const priority =
    type === 'todo' && /(尽快|紧急|马上|立即|重要)/.test(entry.content || '') ? 'high' : entry.priority || 'medium';
  const related = suggestRelated(entry, candidates);
  return {
    type,
    title: entry.title || autoTitle(entry.content),
    summary,
    category,
    tags,
    priority,
    due_date: due,
    related,
    fromAI: false,
  };
}

export function splitConversations(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [];
  const push = (t) => {
    const s = String(t).trim();
    if (s) chunks.push(s);
  };
  const chunks = [];
  const sepBlocks = raw.split(/\n(?:={3,}|-{3,})\n/);
  if (sepBlocks.length > 1) {
    sepBlocks.forEach(push);
    return chunks.slice(0, 500);
  }
  const lines = raw.split('\n');
  let cur = [];
  let headingCount = 0;
  for (const line of lines) {
    if (/^#{1,4}\s+/.test(line)) {
      if (cur.length) push(cur.join('\n'));
      cur = [line];
      headingCount += 1;
    } else {
      cur.push(line);
    }
  }
  push(cur.join('\n'));
  if (headingCount > 0) return chunks.slice(0, 500);
  const sized = [];
  let rest = raw;
  const MAX = 3000;
  while (rest.length > MAX) {
    let cut = rest.lastIndexOf('\n', MAX);
    if (cut < MAX * 0.5) cut = rest.indexOf('\n', MAX);
    if (cut <= 0 || cut >= rest.length) cut = MAX;
    sized.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.trim()) sized.push(rest.trim());
  return sized.filter(Boolean).slice(0, 500);
}

export function firstLineOf(text, max = 24) {
  const first = String(text || '').split('\n').find((l) => l.trim());
  const s = (first || '').replace(/^#+\s*/, '').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function rulesTodoPlan(todos, today) {
  const sorted = [...todos].sort((a, b) => {
    const pr = (t) => (t.priority === 'high' ? 0 : t.priority === 'medium' ? 1 : 2);
    const od = (t) => (t.due_date && t.due_date < today ? 0 : t.due_date ? 1 : 2);
    return (
      od(a) - od(b) ||
      pr(a) - pr(b) ||
      (a.due_date || '9999').localeCompare(b.due_date || '9999') ||
      a.created_at.localeCompare(b.created_at)
    );
  });
  const overdue = todos.filter((t) => t.due_date && t.due_date < today);
  const lines = [`共 ${todos.length} 项未完成待办。`];
  if (overdue.length) lines.push(`⚠️ 其中 ${overdue.length} 项已逾期，建议优先处理。`);
  lines.push('');
  lines.push('建议处理顺序（规则排序：逾期 > 高优先级 > 截止时间）：');
  sorted.slice(0, 12).forEach((t, i) => {
    lines.push(`${i + 1}. ${t.title || t.content.slice(0, 30)}${t.due_date ? `（截止 ${t.due_date}）` : ''}`);
  });
  if (sorted.length > 12) lines.push(`… 其余 ${sorted.length - 12} 项按时间顺序处理`);
  return { title: '待办整理建议', markdown: lines.join('\n'), ordered_ids: sorted.map((t) => t.id) };
}

const TYPE_LABEL = { thought: '想法', todo: '待办', material: '资料', note: '记录' };

export function rulesReport(kind, entries, range) {
  const n = entries.length;
  const byType = {};
  const byCat = {};
  const tagCount = {};
  for (const e of entries) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    byCat[e.category] = (byCat[e.category] || 0) + 1;
    for (const t of e.tags || []) tagCount[t] = (tagCount[t] || 0) + 1;
  }
  const openTodos = entries.filter((e) => e.type === 'todo' && e.status === 'open');
  const doneTodos = entries.filter((e) => e.type === 'todo' && e.status === 'done');
  const fmt = (obj) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v} 条`)
      .join('，') || '无';
  const topTags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => `#${k}`);

  if (kind === 'keypoints') {
    const important = entries.filter(
      (e) => e.priority === 'high' || /(重要|关键|重点|紧急|注意|务必|！|❗)/.test(e.content || ''),
    );
    const lines = [`## 关键要点（${range.label}）`, ''];
    lines.push(`- 该阶段共记录 **${n}** 条内容，其中待办 ${openTodos.length} 项未完成、${doneTodos.length} 项已完成。`);
    if (important.length) {
      lines.push('- 标记为重要/高优先级的内容：');
      important.slice(0, 8).forEach((e) => lines.push(`  - ${e.title || '(无标题)'}（${e.category}）`));
    } else {
      lines.push('- 该阶段没有显式标记为重要的内容。');
    }
    lines.push('');
    lines.push('## 最近记录摘要');
    entries
      .slice(-5)
      .reverse()
      .forEach((e) => lines.push(`- ${e.title || '(无标题)'}：${(e.summary || e.content).slice(0, 60)}`));
    return { title: `重点信息提取（${range.label}）`, markdown: lines.join('\n') };
  }

  if (kind === 'actions') {
    const lines = [`## 后续行动建议（${range.label}）`, ''];
    lines.push(`当前共有 **${openTodos.length}** 项待办未完成。`);
    if (openTodos.length) {
      lines.push('');
      lines.push('### 待办清单');
      openTodos.slice(0, 15).forEach((t) => {
        lines.push(
          `- [ ] ${t.title || t.content.slice(0, 30)}${t.due_date ? `（截止 ${t.due_date}）` : ''}${t.priority === 'high' ? ' ⚠️ 高优先级' : ''}`,
        );
      });
    }
    lines.push('');
    lines.push('### 建议');
    const todayIso = new Date().toISOString().slice(0, 10);
    const overdue = openTodos.filter((t) => t.due_date && t.due_date < todayIso);
    if (overdue.length) lines.push(`1. 立即处理 ${overdue.length} 项已逾期待办，避免继续堆积。`);
    const high = openTodos.filter((t) => t.priority === 'high');
    if (high.length) lines.push('2. 优先完成高优先级待办，再安排其余事项。');
    if (!openTodos.length) lines.push('1. 当前没有未完成待办，可以回顾近期记录，提炼新的目标。');
    lines.push(`${n ? '3.' : '2.'} 建议每周固定时间回顾记录，把零散想法转化为可执行计划。`);
    return { title: `后续行动建议（${range.label}）`, markdown: lines.join('\n') };
  }

  const lines = [`## 阶段总结（${range.label}）`, ''];
  lines.push(`- 共记录 **${n}** 条内容。`);
  lines.push(`- 类型分布：${fmt(byType)}`);
  lines.push(`- 分类分布：${fmt(byCat)}`);
  lines.push(`- 待办情况：${openTodos.length} 项未完成，${doneTodos.length} 项已完成。`);
  if (topTags.length) lines.push(`- 高频标签：${topTags.join(' ')}`);
  lines.push('');
  lines.push('## 最近动态');
  entries
    .slice(-6)
    .reverse()
    .forEach((e) => {
      const label = TYPE_LABEL[e.type] || '记录';
      lines.push(`- [${label}｜${e.category}] ${e.title || '(无标题)'}（${(e.created_at || '').slice(0, 10)}）`);
    });
  return { title: `阶段总结（${range.label}）`, markdown: lines.join('\n') };
}
