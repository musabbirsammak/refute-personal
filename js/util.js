// Small DOM and formatting helpers. html`` escapes every interpolated value
// unless it is already Safe, which keeps student text from injecting markup.

export class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export const raw = (s) => new Safe(String(s ?? ''));

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function val(v) {
  if (v == null || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += val(v) + strings[i + 1]; });
  return new Safe(out);
}

export function mount(el, content) {
  el.innerHTML = content instanceof Safe ? content.s : esc(content);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function navigate(path) {
  const target = '#' + path;
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
}

// Minimal, safe Markdown: escape first, then add formatting.
export function md(text) {
  const src = esc(String(text ?? '')).replace(/\r\n/g, '\n');
  const blocks = [];
  const codeBlocks = [];
  const withCode = src.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(code);
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });
  const inline = (s) => s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?![\w_])/g, '$1<em>$2</em>');

  for (const chunk of withCode.split(/\n{2,}/)) {
    const lines = chunk.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    const code = chunk.match(/^\u0000CODE(\d+)\u0000$/);
    if (code) { blocks.push(`<pre><code>${codeBlocks[+code[1]]}</code></pre>`); continue; }
    let i = 0;
    let para = [];
    const flush = () => { if (para.length) { blocks.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
    while (i < lines.length) {
      const l = lines[i];
      const h = l.match(/^(#{1,4})\s+(.*)$/);
      if (h) { flush(); const lvl = Math.min(4, h[1].length + 2); blocks.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); i++; continue; }
      if (/^\s*[-*•]\s+/.test(l)) {
        flush();
        const items = [];
        while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*•]\s+/, '')); i++; }
        blocks.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
        continue;
      }
      if (/^\s*\d+[.)]\s+/.test(l)) {
        flush();
        const items = [];
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
        blocks.push(`<ol>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`);
        continue;
      }
      para.push(l);
      i++;
    }
    flush();
  }
  return raw(blocks.join('\n').replace(/\u0000CODE(\d+)\u0000/g, (_, n) => `<code>${codeBlocks[+n]}</code>`));
}

let toastTimer;
export function toast(message, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.className = `toast toast-${kind} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6000 : 3000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
  }
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDuration(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const mins = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export function downloadFile(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function toCSV(rows) {
  return '﻿' + rows.map((r) => r.map((c) => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}

export function shareUrl(path) {
  return `${location.origin}${location.pathname}#${path}`;
}

export function loading(text = 'Loading…') {
  return html`<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>${text}</div>`;
}

export function errorBox(message, retryLabel) {
  return html`<div class="notice notice-error" role="alert"><p>${message}</p>${retryLabel ? html`<button class="btn" data-retry>${retryLabel}</button>` : ''}</div>`;
}

export function slug(s) {
  return String(s || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'export';
}

export function autoGrow(textarea, max = 220) {
  const fit = () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(max, textarea.scrollHeight) + 'px';
  };
  textarea.addEventListener('input', fit);
  fit();
}

export function confirmDialog(message, { confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.innerHTML = html`<form method="dialog">
      <p>${message}</p>
      <div class="row-end">
        <button class="btn btn-quiet" value="cancel">Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="ok">${confirmLabel}</button>
      </div>
    </form>`.s;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'ok'); dlg.remove(); });
    dlg.showModal();
  });
}
