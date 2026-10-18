import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderMarkdown(md) {
  return DOMPurify.sanitize(marked.parse(md || ''));
}

export function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return fmtTime(iso).slice(0, 10);
}

export const TYPE_META = {
  thought: { label: '想法', color: '#7c3aed', bg: '#f3efff' },
  todo: { label: '待办', color: '#1d4ed8', bg: '#e8f0ff' },
  material: { label: '资料', color: '#047857', bg: '#e6f6ef' },
  note: { label: '记录', color: '#6b7280', bg: '#f0f1f4' },
};

export const PRIORITY_META = {
  high: { label: '高', color: '#dc2626' },
  medium: { label: '中', color: '#d97706' },
  low: { label: '低', color: '#6b7280' },
};

export const CATEGORIES = ['工作', '学习', '生活', '健康', '财务', '想法', '资料', '其他'];

export function toast(msg, type = 'info') {
  window.dispatchEvent(new CustomEvent('app-toast', { detail: { msg, type } }));
}

export function titleOf(entry) {
  return entry.title || (entry.content || '').split('\n')[0].slice(0, 24) || '无标题';
}
