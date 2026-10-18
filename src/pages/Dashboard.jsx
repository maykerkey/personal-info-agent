import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { CaptureBox, EntryCard, Empty } from '../components.jsx';

function StatCard({ icon, label, value, to }) {
  const body = (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [todos, setTodos] = useState([]);

  const load = async () => {
    try {
      const [s, r, t] = await Promise.all([
        api('/api/stats'),
        api('/api/entries?limit=6'),
        api('/api/todos'),
      ]);
      setStats(s);
      setRecent(r.items);
      setTodos(
        t.groups
          .filter((g) => g.key !== 'done')
          .flatMap((g) => g.items)
          .slice(0, 5),
      );
    } catch {
      /* 静默失败，页面会显示空状态 */
    }
  };

  useEffect(() => {
    load();
    window.addEventListener('entries-changed', load);
    return () => window.removeEventListener('entries-changed', load);
  }, []);

  return (
    <div className="page">
      <h1 className="page-title">今天想记录什么？</h1>
      <p className="page-sub">想法、资料、待办都可以丢进来，我会自动分类、总结并关联相关内容。</p>
      <CaptureBox />
      <div className="stats-row">
        <StatCard icon="📚" label="全部记录" value={stats ? stats.total : '—'} to="/entries" />
        <StatCard icon="✅" label="未完成待办" value={stats ? stats.openTodos : '—'} to="/todos" />
        <StatCard icon="🎉" label="已完成待办" value={stats ? stats.doneTodos : '—'} to="/todos" />
        <StatCard icon="🗂️" label="内容分类" value={stats ? Object.keys(stats.byCategory).length : '—'} to="/entries" />
      </div>
      <div className="two-col">
        <section className="panel">
          <div className="panel-head">
            <h2>最近记录</h2>
            <Link className="more" to="/entries">
              查看全部 →
            </Link>
          </div>
          {recent.length ? (
            recent.map((e) => <EntryCard key={e.id} entry={e} />)
          ) : (
            <Empty text="还没有记录，先在上方记下第一条想法吧" />
          )}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>待办速览</h2>
            <Link className="more" to="/todos">
              去整理 →
            </Link>
          </div>
          {todos.length ? todos.map((e) => <EntryCard key={e.id} entry={e} />) : <Empty text="当前没有待办事项" />}
        </section>
      </div>
    </div>
  );
}
