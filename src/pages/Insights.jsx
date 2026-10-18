import { useState } from 'react';
import { api } from '../api.js';
import { Markdown, Spinner } from '../components.jsx';
import { toast } from '../utils.js';

const PERIODS = [
  ['today', '今日'],
  ['week', '本周'],
  ['month', '本月'],
  ['days30', '近30天'],
  ['all', '全部'],
];

const KINDS = [
  ['summary', '📄 阶段总结'],
  ['keypoints', '🔑 重点信息提取'],
  ['actions', '🚀 后续行动建议'],
];

export default function Insights() {
  const [period, setPeriod] = useState('week');
  const [kind, setKind] = useState('summary');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async (fresh = false) => {
    setLoading(true);
    setResult(null);
    try {
      const r = await api(`/api/insights?kind=${kind}&period=${period}${fresh ? '&fresh=1' : ''}`);
      setResult(r);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">洞察与总结</h1>
      <p className="page-sub">基于已有内容生成阶段总结、提取重点信息、整理后续行动。</p>
      <div className="insights-controls">
        <div className="seg-group">
          {PERIODS.map(([v, label]) => (
            <button
              key={v}
              className={`seg ${period === v ? 'active' : ''}`}
              onClick={() => {
                setPeriod(v);
                setResult(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="seg-group">
          {KINDS.map(([v, label]) => (
            <button
              key={v}
              className={`seg ${kind === v ? 'active' : ''}`}
              onClick={() => {
                setKind(v);
                setResult(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn primary" disabled={loading} onClick={() => run(false)}>
          {loading ? '生成中…' : '生成报告'}
        </button>
      </div>
      {loading ? (
        <div className="center-wrap tall">
          <Spinner />
        </div>
      ) : null}
      {result ? (
        <section className="panel report">
          <div className="report-head">
            <div>
              <div className="report-title">{result.title}</div>
              <div className="report-period">
                {result.period?.label}
                {result.cached ? ' · 上次生成' : ''}
              </div>
            </div>
            <button className="btn ghost" onClick={() => run(true)}>
              🔄 重新生成
            </button>
          </div>
          <Markdown md={result.markdown} />
        </section>
      ) : (
        !loading && (
          <div className="empty tall">
            选择时间范围和报告类型，点击「生成报告」。
            <br />
            未配置大模型时，将使用本地规则生成基础版本。
          </div>
        )
      )}
    </div>
  );
}
