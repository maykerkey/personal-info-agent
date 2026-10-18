import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';
import { renderMarkdown, timeAgo, titleOf, toast, TYPE_META } from './utils.js';

export function Markdown({ md }) {
  return <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />;
}

export function Spinner() {
  return <div className="spinner" />;
}

export function Empty({ text = '暂无内容' }) {
  return <div className="empty">{text}</div>;
}

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const h = (e) => {
      const id = `${Date.now()}-${Math.random()}`;
      setItems((x) => [...x, { id, ...e.detail }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3400);
    };
    window.addEventListener('app-toast', h);
    return () => window.removeEventListener('app-toast', h);
  }, []);
  return (
    <div className="toaster">
      {items.map((i) => (
        <div key={i.id} className={`toast toast-${i.type || 'info'}`}>
          {i.msg}
        </div>
      ))}
    </div>
  );
}

export function EntryCard({ entry }) {
  const meta = TYPE_META[entry.type] || TYPE_META.note;
  const toggle = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await api(`/api/entries/${entry.id}`, {
        method: 'PATCH',
        body: { status: entry.status === 'done' ? 'open' : 'done' },
      });
      window.dispatchEvent(new Event('entries-changed'));
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return (
    <Link to={`/entries/${entry.id}`} className="entry-card">
      <div className="entry-card-top">
        <span className="badge" style={{ color: meta.color, background: meta.bg }}>
          {meta.label}
        </span>
        {entry.type === 'todo' ? (
          <button
            type="button"
            className={`todo-toggle ${entry.status === 'done' ? 'checked' : ''}`}
            onClick={toggle}
            title={entry.status === 'done' ? '标记为未完成' : '标记为完成'}
          >
            {entry.status === 'done' ? '✓' : ''}
          </button>
        ) : null}
      </div>
      <div className="entry-title">{titleOf(entry)}</div>
      {entry.summary ? (
        <div className="entry-summary">{entry.summary}</div>
      ) : (
        <div className="entry-summary muted">{(entry.content || '').slice(0, 120)}</div>
      )}
      <div className="entry-foot">
        <span className="chip">{entry.category || '其他'}</span>
        {(entry.tags || []).slice(0, 3).map((t) => (
          <span key={t} className="chip tag">
            #{t}
          </span>
        ))}
        {entry.related_count > 0 ? <span className="chip link-chip">关联 {entry.related_count}</span> : null}
        <span className="time">{timeAgo(entry.created_at)}</span>
      </div>
    </Link>
  );
}

const TYPE_OPTIONS = [
  ['auto', '✨ 自动识别'],
  ['thought', '💡 想法'],
  ['todo', '✅ 待办'],
  ['material', '📎 资料'],
  ['note', '📝 记录'],
];

export function CaptureBox() {
  const [content, setContent] = useState('');
  const [type, setType] = useState('auto');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api('/api/entries', {
        method: 'POST',
        body: { content: text, type: type === 'auto' ? undefined : type },
      });
      setContent('');
      toast('已保存并完成整理');
      window.dispatchEvent(new Event('entries-changed'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="capture-box">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="记录零散想法、资料或待办，例如：『明天下午 3 点约了客户开会，记得准备方案』… Ctrl+Enter 保存"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
        }}
      />
      <div className="capture-bar">
        <div className="type-options">
          {TYPE_OPTIONS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`type-chip ${type === v ? 'active' : ''}`}
              onClick={() => setType(v)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn primary" disabled={busy || !content.trim()} onClick={submit}>
          {busy ? '正在理解与整理…' : '保存并智能整理'}
        </button>
      </div>
    </div>
  );
}
