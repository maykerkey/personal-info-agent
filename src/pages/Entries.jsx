import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { EntryCard, Empty, Spinner } from '../components.jsx';
import { CATEGORIES, toast } from '../utils.js';

const PAGE = 30;
const TYPES = [
  ['', '全部类型'],
  ['thought', '想法'],
  ['todo', '待办'],
  ['material', '资料'],
  ['note', '记录'],
];

export default function Entries() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const type = params.get('type') || '';
  const category = params.get('category') || '';
  const status = params.get('status') || '';
  const [data, setData] = useState({ items: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (type) query.set('type', type);
  if (category) query.set('category', category);
  if (status) query.set('status', status);
  const qs = query.toString();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await api(`/api/entries?${qs}&limit=${PAGE}&offset=0`);
        if (!cancelled) {
          setData(r);
          setOffset(0);
        }
      } catch (err) {
        if (!cancelled) toast(err.message, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qs, refresh]);

  useEffect(() => {
    const h = () => setRefresh((x) => x + 1);
    window.addEventListener('entries-changed', h);
    return () => window.removeEventListener('entries-changed', h);
  }, []);

  const loadMore = async () => {
    const next = offset + PAGE;
    try {
      const r = await api(`/api/entries?${qs}&limit=${PAGE}&offset=${next}`);
      setData((d) => ({ items: [...d.items, ...r.items], total: r.total }));
      setOffset(next);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const setFilter = (k, v) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  return (
    <div className="page">
      <h1 className="page-title">全部记录</h1>
      <div className="filters">
        <input
          className="filter-input"
          value={q}
          onChange={(e) => setFilter('q', e.target.value)}
          placeholder="🔍 输入关键词检索…"
        />
        <select value={type} onChange={(e) => setFilter('type', e.target.value)}>
          {TYPES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setFilter('category', e.target.value)}>
          <option value="">全部分类</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">全部状态</option>
          <option value="open">进行中</option>
          <option value="done">已完成</option>
          <option value="archived">已归档</option>
        </select>
      </div>
      <div className="result-meta">
        共 {data.total} 条记录
        {q ? `，匹配“${q}”` : ''}
      </div>
      {loading ? (
        <div className="center-wrap">
          <Spinner />
        </div>
      ) : data.items.length ? (
        <>
          <div className="card-grid">
            {data.items.map((e) => (
              <EntryCard key={e.id} entry={e} />
            ))}
          </div>
          {data.items.length < data.total ? (
            <div className="center-wrap">
              <button className="btn ghost" onClick={loadMore}>
                加载更多（还剩 {data.total - data.items.length} 条）
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <Empty text="没有符合条件的记录，换个关键词或筛选条件试试" />
      )}
    </div>
  );
}
