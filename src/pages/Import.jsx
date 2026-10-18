import { useRef, useState } from 'react';
import { api } from '../api.js';
import { toast } from '../utils.js';

export default function ImportPage() {
  const [text, setText] = useState('');
  const [source, setSource] = useState('DeepSeek');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [jsonItems, setJsonItems] = useState(null);
  const fileRef = useRef(null);

  const pickFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const raw = await f.text();
    if (/\.json$/i.test(f.name || '')) {
      try {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.conversations)) {
          setJsonItems(d.conversations);
          setText('');
          if (d.meta?.source && !d.meta.source.includes('DeepSeek')) setSource('其他');
          toast(`识别到结构化对话文件：${d.conversations.length} 段`);
          return;
        }
      } catch {
        /* 不是结构化 JSON，按文本处理 */
      }
    }
    setJsonItems(null);
    setText(raw);
  };

  const preview = async () => {
    if (!text.trim()) return;
    try {
      const r = await api('/api/import?dryRun=1', { method: 'POST', body: { text, source } });
      toast(`识别到 ${r.count} 段对话`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const doImport = async () => {
    if (busy || (!text.trim() && !jsonItems)) return;
    setBusy(true);
    setResult(null);
    try {
      let r;
      if (jsonItems) {
        let imported = 0;
        let skipped = 0;
        for (let i = 0; i < jsonItems.length; i += 500) {
          const part = await api('/api/import', {
            method: 'POST',
            body: { source, items: jsonItems.slice(i, i + 500).map((c) => ({ fields: c })) },
          });
          imported += part.imported;
          skipped += part.skipped;
        }
        r = { imported, skipped, source };
        setJsonItems(null);
      } else {
        r = await api('/api/import', { method: 'POST', body: { text, source } });
        setText('');
      }
      setResult(r);
      toast(`成功导入 ${r.imported} 条记录`);
      window.dispatchEvent(new Event('entries-changed'));
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">导入 DeepSeek 对话</h1>
      <p className="page-sub">
        把你在 DeepSeek 上的讨论粘贴进来，自动按「对话」拆分保存，之后就能被检索、问答、总结。
      </p>
      <section className="panel">
        <div className="panel-head">
          <h2>怎么取回 DeepSeek 上的对话</h2>
        </div>
        <ol className="import-steps">
          <li>在浏览器打开 chat.deepseek.com，进入一个对话</li>
          <li>点击对话区域，按 Ctrl+A 全选、Ctrl+C 复制（手机端长按全选复制）</li>
          <li>回到这里粘贴，多个对话之间用标题行或一行 <code>====</code> 分隔也可以</li>
        </ol>
      </section>
      <section className="panel">
        <div className="import-toolbar">
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option>DeepSeek</option>
            <option>ChatGPT</option>
            <option>其他</option>
          </select>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            📄 从文件导入（.txt / .md / .json）
          </button>
          <input ref={fileRef} type="file" accept=".txt,.md,.json,.markdown" hidden onChange={pickFile} />
        </div>
        <textarea
          className="import-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'在这里粘贴 DeepSeek 对话内容…\n\n示例：\n# 关于健身计划的讨论\n你：我想开始健身…\nDeepSeek：…\n\n====\n\n# 关于装修预算的讨论\n…'}
        />
        {jsonItems ? (
          <div className="import-result">已加载结构化文件：{jsonItems.length} 段对话，点击「导入全部对话」入库。</div>
        ) : null}
        <div className="import-actions">
          <span className="result-meta">{text ? `${text.length} 字符` : ''}</span>
          <button className="btn ghost" disabled={(!text.trim() && !jsonItems) || busy} onClick={preview}>
            🔎 识别分段
          </button>
          <button className="btn primary" disabled={(!text.trim() && !jsonItems) || busy} onClick={doImport}>
            {busy ? '导入中…' : '⬇ 导入全部对话'}
          </button>
        </div>
        {result ? (
          <div className="import-result">
            完成：导入 {result.imported} 条，跳过 {result.skipped} 条，已打上「对话 / {result.source}」标签。
          </div>
        ) : null}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h2>说明</h2>
        </div>
        <p className="settings-desc">
          DeepSeek 网页目前没有官方「一键导出全部历史」的功能，粘贴文本是最通用的方式。导入的记录会生成标题、分类和摘要；
          如果想获得更深度的整理，导入后去「设置」页点一次「重新智能整理全部记录」，会由大模型逐条处理。
        </p>
      </section>
    </div>
  );
}
