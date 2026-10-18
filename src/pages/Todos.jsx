import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Markdown, Spinner } from '../components.jsx';
import { toast, titleOf, PRIORITY_META } from '../utils.js';

export default function Todos() {
  const [data, setData] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [ordered, setOrdered] = useState(null);

  const load = async () => {
    try {
      setData(await api('/api/todos'));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  useEffect(() => {
    load();
    window.addEventListener('entries-changed', load);
    return () => window.removeEventListener('entries-changed', load);
  }, []);

  const toggle = async (t) => {
    try {
      await api(`/api/entries/${t.id}`, {
        method: 'PATCH',
        body: { status: t.status === 'done' ? 'open' : 'done' },
      });
      window.dispatchEvent(new Event('entries-changed'));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const runPlan = async () => {
    setPlanning(true);
    try {
      const r = await api('/api/todos/plan', { method: 'POST' });
      setPlan(r);
      setOrdered(r.ordered_ids?.length ? r.ordered_ids : null);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setPlanning(false);
    }
  };

  if (!data) {
    return (
      <div className="center-wrap tall">
        <Spinner />
      </div>
    );
  }

  const orderMap = ordered ? new Map(ordered.map((id, i) => [id, i + 1])) : null;

  return (
    <div className="page">
      <div className="page-head-row">
        <div>
          <h1 className="page-title">待办整理</h1>
          <p className="page-sub">
            {data.open} 项未完成 · {data.total - data.open} 项已完成
          </p>
        </div>
        <button className="btn primary" disabled={planning || !data.open} onClick={runPlan}>
          {planning ? '整理中…' : '✨ AI 整理待办'}
        </button>
      </div>
      {plan ? (
        <section className="panel plan-panel">
          <div className="panel-head">
            <h2>{plan.title || '待办整理建议'}</h2>
            <button className="link-btn" onClick={() => setPlan(null)}>
              收起
            </button>
          </div>
          <Markdown md={plan.markdown} />
        </section>
      ) : null}
      {data.groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section className="panel" key={g.key}>
            <div className="panel-head">
              <h2>
                {g.key === 'overdue' ? '🔴' : g.key === 'today' ? '🟡' : g.key === 'done' ? '✅' : '📋'} {g.label}
              </h2>
              <span className="group-count">{g.items.length}</span>
            </div>
            <div className="todo-list">
              {g.items.map((t) => (
                <div key={t.id} className={`todo-row ${t.status === 'done' ? 'done' : ''}`}>
                  {orderMap && g.key !== 'done' ? (
                    <span className="order-badge">{orderMap.get(t.id) || '·'}</span>
                  ) : null}
                  <button
                    type="button"
                    className={`todo-toggle big ${t.status === 'done' ? 'checked' : ''}`}
                    onClick={() => toggle(t)}
                    title={t.status === 'done' ? '标记为未完成' : '标记为完成'}
                  >
                    {t.status === 'done' ? '✓' : ''}
                  </button>
                  <div className="todo-body">
                    <div className="todo-title">
                      {titleOf(t)}
                      {t.priority === 'high' ? (
                        <span className="chip" style={{ color: (PRIORITY_META.high || {}).color }}>
                          ⚠️ 高优先级
                        </span>
                      ) : null}
                    </div>
                    <div className="todo-meta">
                      {t.category || '其他'}
                      {t.due_date ? ` · 截止 ${t.due_date}` : ' · 无截止日期'}
                      {t.summary ? ` · ${t.summary}` : ''}
                    </div>
                  </div>
                  <Link className="more" to={`/entries/${t.id}`}>
                    详情 →
                  </Link>
                </div>
              ))}
            </div>
          </section>
        ))}
      {!data.total ? <Empty text="还没有待办事项，去首页记录『明天要做什么』试试" /> : null}
    </div>
  );
}
