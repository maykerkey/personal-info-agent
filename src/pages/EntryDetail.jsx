import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Spinner } from '../components.jsx';
import { fmtTime, toast, titleOf, TYPE_META, PRIORITY_META } from '../utils.js';

export default function EntryDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [entry, setEntry] = useState(null);
  const [related, setRelated] = useState([]);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api(`/api/entries/${id}`);
        if (!cancelled) {
          setEntry(r.entry);
          setRelated(r.related);
        }
      } catch (err) {
        if (!cancelled && /未找到/.test(err.message)) setNotFound(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (notFound) {
    return (
      <div className="page">
        <Empty404 />
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="center-wrap tall">
        <Spinner />
      </div>
    );
  }

  const meta = TYPE_META[entry.type] || TYPE_META.note;
  const act = async (patch, doneMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api(`/api/entries/${entry.id}`, { method: 'PATCH', body: patch });
      setEntry(r.entry);
      toast(doneMsg);
      window.dispatchEvent(new Event('entries-changed'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('确定删除这条记录吗？删除后无法恢复。')) return;
    try {
      await api(`/api/entries/${entry.id}`, { method: 'DELETE' });
      toast('已删除');
      window.dispatchEvent(new Event('entries-changed'));
      navigate(-1);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="page detail-page">
      <Link className="back-link" to="/entries">
        ← 返回记录列表
      </Link>
      <div className="panel detail-card">
        <div className="detail-head">
          <span className="badge" style={{ color: meta.color, background: meta.bg }}>
            {meta.label}
          </span>
          <span className="chip">{entry.category || '其他'}</span>
          {entry.priority !== 'medium' ? (
            <span className="chip" style={{ color: (PRIORITY_META[entry.priority] || {}).color }}>
              优先级：{(PRIORITY_META[entry.priority] || {}).label || '中'}
            </span>
          ) : null}
          {entry.due_date ? <span className="chip">截止 {entry.due_date}</span> : null}
          {entry.ai_processed ? <span className="chip ai-chip">✨ 智能整理</span> : null}
          <span className="time">{fmtTime(entry.created_at)}</span>
        </div>
        <h1 className="detail-title">{titleOf(entry)}</h1>
        {entry.summary ? <div className="detail-summary">💡 {entry.summary}</div> : null}
        <div className="detail-content">{entry.content}</div>
        {entry.tags?.length ? (
          <div className="detail-tags">
            {entry.tags.map((t) => (
              <span key={t} className="chip tag">
                #{t}
              </span>
            ))}
          </div>
        ) : null}
        <div className="detail-actions">
          {entry.status !== 'archived' ? (
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                act({ status: entry.status === 'done' ? 'open' : 'done' }, entry.status === 'done' ? '已恢复' : '已完成')
              }
            >
              {entry.status === 'done' ? '↩ 恢复为进行中' : '✔ 标记完成'}
            </button>
          ) : null}
          <button className="btn ghost" disabled={busy} onClick={() => act({ status: 'archived' }, '已归档')}>
            🗄 归档
          </button>
          <button className="btn danger-ghost" disabled={busy} onClick={remove}>
            🗑 删除
          </button>
        </div>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h2>相关内容</h2>
        </div>
        {related.length ? (
          <div className="related-list">
            {related.map((r) => (
              <Link key={r.id} to={`/entries/${r.id}`} className="related-item">
                <div className="related-title">
                  <span className="badge" style={{ color: (TYPE_META[r.type] || {}).color, background: (TYPE_META[r.type] || {}).bg }}>
                    {(TYPE_META[r.type] || {}).label || '记录'}
                  </span>
                  {r.title || '(无标题)'}
                </div>
                <div className="related-summary">{r.summary || r.content || ''}</div>
                {r.reason ? <div className="related-reason">🔗 {r.reason}</div> : null}
              </Link>
            ))}
          </div>
        ) : (
          <Empty text="暂无关联内容，继续记录会自动发现关联" />
        )}
      </section>
    </div>
  );
}

function Empty404() {
  return (
    <div className="empty tall">
      未找到该记录，它可能已被删除。
      <div>
        <Link className="more" to="/entries">
          返回列表 →
        </Link>
      </div>
    </div>
  );
}
