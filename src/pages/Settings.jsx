import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { toast } from '../utils.js';

export default function Settings() {
  const [health, setHealth] = useState(null);
  const [llm, setLlm] = useState(null);
  const [form, setForm] = useState({ apiKey: '', baseUrl: '', model: '' });
  const [authInfo, setAuthInfo] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAuth, setSavingAuth] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [h, l, a] = await Promise.all([
          api('/api/health'),
          api('/api/settings/llm'),
          api('/api/settings/auth'),
        ]);
        setHealth(h);
        setLlm(l);
        setAuthInfo(a);
        setForm((f) => ({ ...f, baseUrl: l.baseUrl || '', model: l.model || '' }));
      } catch {
        /* 静默 */
      }
    };
    load();
  }, []);

  const reprocess = async () => {
    if (!window.confirm('将用大模型重新分类、总结和关联全部记录，需要消耗 API 调用。确定继续吗？')) return;
    setBusy(true);
    try {
      const r = await api('/api/reprocess', { method: 'POST' });
      toast(`整理完成：成功 ${r.done} / ${r.total} 条`);
      window.dispatchEvent(new Event('entries-changed'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveLlm = async () => {
    setSaving(true);
    try {
      const body = {};
      if (form.apiKey.trim()) body.apiKey = form.apiKey.trim();
      if (form.baseUrl.trim()) body.baseUrl = form.baseUrl.trim();
      if (form.model.trim()) body.model = form.model.trim();
      const r = await api('/api/settings/llm', { method: 'POST', body });
      setLlm(r);
      setHealth((h) => (h ? { ...h, ai: r.enabled, model: r.model } : h));
      setForm((f) => ({ ...f, apiKey: '' }));
      toast('大模型配置已保存并生效');
      window.dispatchEvent(new Event('config-changed'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const clearLlm = async () => {
    if (!window.confirm('清空应用内保存的大模型配置？（环境变量中的配置不受影响）')) return;
    try {
      const r = await api('/api/settings/llm', { method: 'POST', body: { clear: true } });
      setLlm(r);
      setHealth((h) => (h ? { ...h, ai: r.enabled, model: r.model } : h));
      toast('已清空');
      window.dispatchEvent(new Event('config-changed'));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const saveAuth = async (clear = false) => {
    if (!clear && !newPassword.trim()) return;
    setSavingAuth(true);
    try {
      const r = await api('/api/settings/auth', {
        method: 'POST',
        body: clear ? { clear: true } : { password: newPassword.trim() },
      });
      setAuthInfo(r);
      setNewPassword('');
      setHealth((h) => (h ? { ...h, auth: r.required } : h));
      toast(clear ? '已关闭访问密码' : '访问密码已生效，接下来请用新密码登录');
      window.dispatchEvent(new Event('config-changed'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingAuth(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">设置与状态</h1>
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>系统状态</h2>
          </div>
          <div className="settings-list">
            <div className="settings-row">
              <span>大模型</span>
              <span>{llm ? (llm.enabled ? `✅ 已连接（${llm.model}）` : '⚠️ 未配置（规则模式）') : '…'}</span>
            </div>
            <div className="settings-row">
              <span>数据存储</span>
              <span>{health?.storageMode || '…'}</span>
            </div>
            <div className="settings-row">
              <span>访问保护</span>
              <span>{health ? (health.auth ? '✅ 已启用密码' : '未启用') : '…'}</span>
            </div>
            <div className="settings-row">
              <span>版本</span>
              <span>{health?.version || '…'}</span>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>大模型配置</h2>
          </div>
          {llm ? (
            <>
              <div className="settings-list">
                <div className="settings-row">
                  <span>配置来源</span>
                  <span>{llm.source === 'env' ? '环境变量（.env）' : llm.source === 'db' ? '应用内保存' : '未配置'}</span>
                </div>
                <div className="settings-row">
                  <span>密钥</span>
                  <span>{llm.hasKey ? `已配置 ${llm.keyTail}` : '未配置'}</span>
                </div>
              </div>
              <div className="settings-form">
                <label>API Key（留空表示不修改）</label>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder="sk-…"
                />
                <label>Base URL（DeepSeek 默认为 https://api.deepseek.com/v1）</label>
                <input
                  value={form.baseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  placeholder="https://api.deepseek.com/v1"
                />
                <label>模型名称</label>
                <input
                  value={form.model}
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  placeholder="deepseek-chat"
                />
              </div>
              <div className="settings-actions">
                <button className="btn primary" disabled={saving} onClick={saveLlm}>
                  {saving ? '保存中…' : '保存并生效'}
                </button>
                <button className="btn ghost" onClick={clearLlm}>
                  清空应用内配置
                </button>
              </div>
              {llm.source === 'env' ? (
                <div className="form-hint">当前生效的配置来自服务端 .env 环境变量，应用内修改会被它覆盖。</div>
              ) : null}
            </>
          ) : null}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>访问密码</h2>
          </div>
          <p className="settings-desc">
            {authInfo?.required ? '当前已启用访问密码，打开应用需要登录。' : '当前未设置密码，任何知道网址的人都能访问。上线后建议立即设置。'}
          </p>
          <div className="settings-form">
            <label>新密码（留空表示不修改）</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="设置至少 6 位的访问密码"
            />
          </div>
          <div className="settings-actions">
            <button className="btn primary" disabled={savingAuth || !newPassword.trim()} onClick={() => saveAuth(false)}>
              {savingAuth ? '保存中…' : '设置 / 修改密码'}
            </button>
            {authInfo?.required ? (
              <button className="btn ghost" disabled={savingAuth} onClick={() => saveAuth(true)}>
                关闭密码保护
              </button>
            ) : null}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>智能整理</h2>
          </div>
          <p className="settings-desc">
            用大模型对全部已有记录重新进行分类、摘要、标签和关联分析（规则模式下保存的记录可通过它升级）。
          </p>
          <button className="btn primary" disabled={busy || !health?.ai} onClick={reprocess}>
            {busy ? '整理中…' : '✨ 重新智能整理全部记录'}
          </button>
          {health && !health.ai ? (
            <div className="form-hint">未配置大模型，此功能不可用。请在服务端 .env 中设置 OPENAI_API_KEY。</div>
          ) : null}
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>配置说明</h2>
          </div>
          <p className="settings-desc">
            服务端通过环境变量配置（详见项目 README.md）：
          </p>
          <div className="code-block">
            OPENAI_API_KEY=你的密钥
            <br />
            OPENAI_BASE_URL=（可选，兼容服务地址）
            <br />
            DATABASE_URL=file:data/info.db 或 libsql://…
            <br />
            APP_PASSWORD=（可选，设置访问密码）
          </div>
          <p className="settings-desc">
            数据默认存于服务端 data/ 目录；把 DATABASE_URL 指向 Turso 等云端数据库后，数据即存储于云端。
          </p>
        </section>
      </div>
    </div>
  );
}
