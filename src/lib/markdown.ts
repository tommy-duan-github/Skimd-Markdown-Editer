import hljs from 'highlight.js/lib/core';
import langBash from 'highlight.js/lib/languages/bash';
import langCss from 'highlight.js/lib/languages/css';
import langDiff from 'highlight.js/lib/languages/diff';
import langIni from 'highlight.js/lib/languages/ini';
import langJs from 'highlight.js/lib/languages/javascript';
import langJson from 'highlight.js/lib/languages/json';
import langMd from 'highlight.js/lib/languages/markdown';
import langPs from 'highlight.js/lib/languages/powershell';
import langSql from 'highlight.js/lib/languages/sql';
import langTs from 'highlight.js/lib/languages/typescript';
import langXml from 'highlight.js/lib/languages/xml';
import langYaml from 'highlight.js/lib/languages/yaml';
import yaml from 'js-yaml';
import { Marked, Renderer } from 'marked';
import type { FrontmatterEntry, OutlineItem } from '../types.ts';
import { escapeHtml } from './formats.ts';

hljs.registerLanguage('bash', langBash);
hljs.registerLanguage('sh', langBash);
hljs.registerLanguage('shell', langBash);
hljs.registerLanguage('css', langCss);
hljs.registerLanguage('diff', langDiff);
hljs.registerLanguage('ini', langIni);
hljs.registerLanguage('toml', langIni);
hljs.registerLanguage('javascript', langJs);
hljs.registerLanguage('js', langJs);
hljs.registerLanguage('json', langJson);
hljs.registerLanguage('jsonc', langJson);
hljs.registerLanguage('markdown', langMd);
hljs.registerLanguage('md', langMd);
hljs.registerLanguage('powershell', langPs);
hljs.registerLanguage('ps1', langPs);
hljs.registerLanguage('sql', langSql);
hljs.registerLanguage('typescript', langTs);
hljs.registerLanguage('ts', langTs);
hljs.registerLanguage('xml', langXml);
hljs.registerLanguage('html', langXml);
hljs.registerLanguage('svg', langXml);
hljs.registerLanguage('yaml', langYaml);
hljs.registerLanguage('yml', langYaml);

export { hljs };

export interface MarkdownRenderResult {
  html: string;
  outline: OutlineItem[];
  frontmatter: FrontmatterEntry[];
  rawFrontmatter: string;
}

export type SanitizerFn = (dirtyHtml: string) => string;

let cachedDomPurify: SanitizerFn | null = null;

function defaultSanitize(dirtyHtml: string): string {
  if (cachedDomPurify) return cachedDomPurify(dirtyHtml);
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return dirtyHtml;
  }
  // Lazy-loaded only in browser/WebView2 runtime so Node unit tests remain lightweight
  return dirtyHtml;
}

export function registerSanitizer(fn: SanitizerFn): void {
  cachedDomPurify = fn;
}

export function highlightCode(code: string, langHint?: string): { html: string; language: string } {
  const normalized = (langHint ?? '').trim().toLowerCase();
  if (normalized && hljs.getLanguage(normalized)) {
    return {
      html: hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value,
      language: normalized
    };
  }
  return {
    html: escapeHtml(code),
    language: normalized || 'text'
  };
}

export function extractFrontmatter(source: string): {
  frontmatter: FrontmatterEntry[];
  body: string;
  rawFrontmatter: string;
} {
  const normalized = source.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { frontmatter: [], body: source, rawFrontmatter: '' };
  }
  const endIdx = normalized.indexOf('\n---\n', 4);
  const eofEnd = normalized.endsWith('\n---') ? normalized.length - 4 : -1;
  const closePos = endIdx !== -1 ? endIdx : eofEnd;
  if (closePos === -1) {
    return { frontmatter: [], body: source, rawFrontmatter: '' };
  }

  const rawYaml = normalized.slice(4, closePos);
  const rawFrontmatter = `---\n${rawYaml}\n---\n\n`;
  const body = endIdx !== -1 ? normalized.slice(endIdx + 5).replace(/^\n+/, '') : '';

  try {
    const parsed = yaml.load(rawYaml);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { frontmatter: [], body: source, rawFrontmatter: '' };
    }
    const entries: FrontmatterEntry[] = Object.entries(parsed as Record<string, unknown>).map(
      ([key, val]) => ({
        key,
        value: formatFrontmatterValue(val)
      })
    );
    return { frontmatter: entries, body, rawFrontmatter };
  } catch {
    return { frontmatter: [], body: source, rawFrontmatter: '' };
  }
}

function formatFrontmatterValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (Array.isArray(val)) return val.map((v) => String(v)).join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export function slugifyHeading(text: string): string {
  const plain = text
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return plain || 'section';
}

export function resolveAssetUrl(rawHref: string, docDir: string | null): string {
  const trimmed = rawHref.trim();
  if (!trimmed) return trimmed;
  if (
    /^(https?:|data:|blob:|mailto:|tel:|#)/i.test(trimmed) ||
    trimmed.startsWith('https://skimd-asset.local/')
  ) {
    return trimmed;
  }
  if (!docDir) return trimmed;

  // Resolve relative Windows or POSIX path against docDir without Node's path module
  const isAbsWin = /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\');
  let combined: string;
  if (isAbsWin) {
    combined = trimmed.replace(/\//g, '\\');
  } else {
    const cleanRel = trimmed.replace(/^\.\//, '').replace(/\//g, '\\');
    const baseParts = docDir.replace(/[\\/]+$/, '').split('\\');
    for (const seg of cleanRel.split('\\')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        if (baseParts.length > 1) baseParts.pop();
      } else {
        baseParts.push(seg);
      }
    }
    combined = baseParts.join('\\');
  }
  return `https://skimd-asset.local/file?path=${encodeURIComponent(combined)}`;
}

const CALLOUT_LABELS: Record<string, { label: string; kind: string }> = {
  NOTE: { label: 'Note', kind: 'note' },
  TIP: { label: 'Tip', kind: 'tip' },
  IMPORTANT: { label: 'Important', kind: 'important' },
  WARNING: { label: 'Warning', kind: 'warning' },
  CAUTION: { label: 'Caution', kind: 'caution' }
};

function transformGitHubAlerts(html: string): string {
  return html.replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:<br\s*\/?>|\r?\n)?([\s\S]*?)<\/p>([\s\S]*?)<\/blockquote>/gi,
    (_match, rawType: string, firstParaBody: string, rest: string) => {
      const meta = CALLOUT_LABELS[rawType.toUpperCase()] ?? CALLOUT_LABELS.NOTE;
      const bodyHtml = firstParaBody.trim() ? `<p>${firstParaBody.trim()}</p>${rest}` : rest;
      return `<div class="callout callout-${meta.kind}"><div class="callout-title">${meta.label}</div><div class="callout-body">${bodyHtml}</div></div>`;
    }
  );
}

export function renderMarkdown(
  source: string,
  options: {
    docDir?: string | null;
    sanitizer?: SanitizerFn;
  } = {}
): MarkdownRenderResult {
  const { frontmatter, body, rawFrontmatter } = extractFrontmatter(source);
  const outline: OutlineItem[] = [];
  const slugCounts = new Map<string, number>();
  let taskCounter = 0;

  const instance = new Marked({
    gfm: true,
    breaks: false
  });
  const renderer = new Renderer();

  renderer.heading = function ({ tokens, depth }) {
    const innerHtml = this.parser.parseInline(tokens);
    const plainText = innerHtml.replace(/<[^>]+>/g, '').trim();
    const baseSlug = slugifyHeading(plainText);
    const count = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, count + 1);
    const id = count === 0 ? baseSlug : `${baseSlug}-${count}`;

    if (depth <= 4) {
      outline.push({ id, text: plainText || 'Untitled', level: depth });
    }

    return `<h${depth} id="${escapeHtml(id)}"><a class="heading-anchor" contenteditable="false" href="#${escapeHtml(
      id
    )}" aria-label="Link to section">#</a>${innerHtml}</h${depth}>\n`;
  };

  renderer.code = ({ text, lang }) => {
    const { html, language } = highlightCode(text, lang);
    const safeLang = escapeHtml(language);
    return `<div class="code-block"><div class="code-block-header" contenteditable="false"><span class="code-lang">${safeLang}</span><button type="button" class="code-copy-btn" data-code-copy="true" title="Copy code">Copy</button></div><pre><code class="hljs language-${safeLang}">${html}</code></pre></div>\n`;
  };

  renderer.image = ({ href, title, text }) => {
    const orig = href ?? '';
    const resolved = resolveAssetUrl(orig, options.docDir ?? null);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<img src="${escapeHtml(resolved)}" data-orig-src="${escapeHtml(orig)}" alt="${escapeHtml(
      text ?? ''
    )}"${titleAttr} loading="lazy" />`;
  };

  renderer.checkbox = ({ checked }) => {
    const idx = taskCounter++;
    const checkedAttr = checked ? ' checked' : '';
    return `<input type="checkbox" class="task-checkbox" data-task-index="${idx}"${checkedAttr} /> `;
  };

  instance.use({ renderer });

  const rawHtml = instance.parse(body) as string;
  const withAlerts = transformGitHubAlerts(rawHtml);
  const sanitize = options.sanitizer ?? defaultSanitize;
  const html = sanitize(withAlerts);

  return { html, outline, frontmatter, rawFrontmatter };
}

export function toggleMarkdownTask(source: string, targetTaskIndex: number): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const useCrlf = source.includes('\r\n');
  let inFence = false;
  let fenceChar = '';
  let taskIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (marker === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const taskMatch = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s*.*)$/);
    if (taskMatch) {
      if (taskIdx === targetTaskIndex) {
        const nextMark = taskMatch[2] === ' ' ? 'x' : ' ';
        lines[i] = `${taskMatch[1]}${nextMark}${taskMatch[3]}`;
        break;
      }
      taskIdx++;
    }
  }

  return lines.join(useCrlf ? '\r\n' : '\n');
}
