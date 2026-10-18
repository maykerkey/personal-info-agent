import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';
import { Spinner, Toaster } from './components.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Entries from './pages/Entries.jsx';
import EntryDetail from './pages/EntryDetail.jsx';
import Todos from './pages/Todos.jsx';
import Ask from './pages/Ask.jsx';
import Insights from './pages/Insights.jsx';
import Settings from './pages/Settings.jsx';
import ImportPage from './pages/Import.jsx';

const NAV = [
  ['/', '🏡', '首页'],
  ['/entries', '📒', '全部记录'],
  ['/todos', '✅', '待办整理'],
  ['/ask', '💬', '智能问答'],
  ['/insights', '📊', '洞察总结'],
  ['/import', '📥', '导入'],
  ['/settings', '⚙️', '设置'],
];

function Login({ onSuccess }) {
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!pwd || busy) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { password: pwd } });
      setToken(r.token);
      onSuccess(r.token);
    } catch (err2) {
      setErr(err2.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">🧠</div>
        <h1>个人信息管家</h1>
        <p className="login-sub">输入访问密码，进入你的私人信息空间</p>
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          placeholder="访问密码"
          autoFocus
        />
        {err ? <div className="form-error">{err}</div> : null}
        <button type="submit" className="btn primary block" disabled={busy}>
          {busy ? '验证中…' : '进入'}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState({ loaded: false, required: false, ai: false, storage: '' });
  const [token, setTokenState] = useState(getToken());
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const load = () =>
      api('/api/auth/status')
        .then((s) => setAuth({ loaded: true, ...s }))
        .catch(() => setAuth((a) => ({ ...a, loaded: true })));
    load();
    const h = () => setTokenState(null);
    window.addEventListener('auth-expired', h);
    window.addEventListener('config-changed', load);
    return () => {
      window.removeEventListener('auth-expired', h);
      window.removeEventListener('config-changed', load);
    };
  }, []);

  if (!auth.loaded) {
    return (
      <div className="loading-screen">
        <Spinner />
      </div>
    );
  }

  if (auth.required && !token) {
    return (
      <>
        <Login onSuccess={(t) => setTokenState(t)} />
        <Toaster />
      </>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">🧠</span>
          <div>
            <div className="brand-name">个人信息管家</div>
            <div className="brand-sub">Personal Info Agent</div>
          </div>
        </div>
        <nav className="side-nav">
          {NAV.map(([to, icon, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-status">
          <div className="status-row">
            <span className={`dot ${auth.ai ? 'ok' : 'warn'}`} />
            {auth.ai ? '大模型已连接' : '离线规则模式'}
          </div>
          <div className="status-row">
            <span className="dot ok" />
            {auth.storage}
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <form
            className="search-form"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(search.trim() ? `/entries?q=${encodeURIComponent(search.trim())}` : '/entries');
            }}
          >
            <input
              className="search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 搜索记录：关键词 / 标签 / 内容…"
            />
          </form>
        </header>
        <div className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/entries" element={<Entries />} />
            <Route path="/entries/:id" element={<EntryDetail />} />
            <Route path="/todos" element={<Todos />} />
            <Route path="/ask" element={<Ask />} />
            <Route path="/insights" element={<Insights />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
      <Toaster />
    </div>
  );
}
