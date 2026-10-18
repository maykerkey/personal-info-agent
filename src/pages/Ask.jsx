import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Markdown, Spinner } from '../components.jsx';
import { toast, TYPE_META } from '../utils.js';

const SUGGESTIONS = [
  '我最近记录了哪些重要的事？',
  '有哪些待办还没完成？',
  '帮我总结一下关于「工作」的记录',
];

export default function Ask() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const endRef = useRef(null);

  useEffect(() => {
    api('/api/chat/history')
      .then((r) => setMessages(r.messages || []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    const next = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const r = await api('/api/ask', { method: 'POST', body: { question: q } });
      setMessages([...next, { role: 'assistant', content: r.answer, citations: r.citations || [] }]);
    } catch (err) {
      setMessages([...next, { role: 'assistant', content: `出错了：${err.message}`, citations: [] }]);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    try {
      await api('/api/chat/history', { method: 'DELETE' });
      setMessages([]);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div className="page ask-page">
      <div className="page-head-row">
        <div>
          <h1 className="page-title">智能问答</h1>
          <p className="page-sub">基于你的全部记录回答问题，回答会标注引用来源。</p>
        </div>
        {messages.length ? (
          <button className="btn ghost" onClick={clear}>
            🗑 清空对话
          </button>
        ) : null}
      </div>
      <div className="chat">
        {!loaded ? (
          <div className="center-wrap">
            <Spinner />
          </div>
        ) : null}
        {loaded && !messages.length ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">💬</div>
            <p>问我任何关于你记录的问题，例如：</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={`bubble-row ${m.role}`}>
            <div className="bubble-avatar">{m.role === 'user' ? '🙋' : '🧠'}</div>
            <div className="bubble">
              {m.role === 'assistant' ? <Markdown md={m.content} /> : <div className="plain">{m.content}</div>}
              {m.role === 'assistant' && m.citations?.length ? (
                <div className="citations">
                  <span className="citations-label">引用来源：</span>
                  {m.citations.map((c) => (
                    <Link key={c.id} className="citation-chip" to={`/entries/${c.id}`}>
                      {(TYPE_META[c.type] || {}).label || '记录'} · {c.title}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="bubble-row assistant">
            <div className="bubble-avatar">🧠</div>
            <div className="bubble">
              <Spinner />
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
      <form
        className="ask-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你的问题…"
          disabled={busy}
        />
        <button type="submit" className="btn primary" disabled={busy || !input.trim()}>
          发送
        </button>
      </form>
    </div>
  );
}
