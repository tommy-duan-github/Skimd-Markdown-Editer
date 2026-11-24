import yaml from 'js-yaml';
import type { FileFormat, OutlineItem } from '../types.ts';
import { escapeHtml } from './formats.ts';
import { highlightCode } from './markdown.ts';

export interface StructuredRenderResult {
  html: string;
  outline: OutlineItem[];
  valid: boolean;
  errorMessage?: string;
  summary: string;
}

export function stripJsonComments(input: string): string {
  let out = '';
  let inString = false;
  let stringEscaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      } else if (ch === '\n') {
        out += '\n';
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (stringEscaped) {
        stringEscaped = false;
      } else if (ch === '\\') {
        stringEscaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    out += ch;
  }

  // Also strip trailing commas before } or ] safely outside strings
  return out.replace(/,\s*([}\]])/g, '$1');
}

function renderTreeNode(
  keyLabel: string | null,
  value: unknown,
  path: string,
  depth: number,
  outline: OutlineItem[]
): string {
  const keySlug = `key-${outline.length}-${path.replace(/[^\w-]/g, '_')}`;

  if (depth === 1 && keyLabel !== null) {
    outline.push({ id: keySlug, text: keyLabel, level: 1 });
  }

  const keyHtml =
    keyLabel !== null
      ? `<span class="tree-key" id="${depth === 1 ? escapeHtml(keySlug) : ''}" data-json-path="${escapeHtml(
          path
        )}" title="Click to copy path">${escapeHtml(keyLabel)}</span><span class="tree-colon">:</span> `
      : '';

  if (value === null) {
    return `<div class="tree-leaf">${keyHtml}<span class="tree-null">null</span></div>`;
  }
  if (typeof value === 'boolean') {
    return `<div class="tree-leaf">${keyHtml}<span class="tree-bool">${value}</span></div>`;
  }
  if (typeof value === 'number') {
    return `<div class="tree-leaf">${keyHtml}<span class="tree-num">${value}</span></div>`;
  }
  if (typeof value === 'string') {
    return `<div class="tree-leaf">${keyHtml}<span class="tree-str">"${escapeHtml(value)}"</span></div>`;
  }
  if (value instanceof Date) {
    return `<div class="tree-leaf">${keyHtml}<span class="tree-str">${escapeHtml(
      value.toISOString()
    )}</span></div>`;
  }

  const isArr = Array.isArray(value);
  const entries = isArr
    ? value.map((v, idx) => [String(idx), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const countLabel = isArr ? `[${entries.length}]` : `{${entries.length}}`;
  const openAttr = depth < 2 ? ' open' : '';

  if (entries.length === 0) {
    return `<div class="tree-leaf">${keyHtml}<span class="tree-muted">${isArr ? '[]' : '{}'}</span></div>`;
  }

  const childrenHtml = entries
    .map(([k, v]) => {
      const childPath = isArr ? `${path}[${k}]` : path ? `${path}.${k}` : k;
      return renderTreeNode(k, v, childPath, depth + 1, outline);
    })
    .join('');

  return `<details class="tree-branch"${openAttr}>
    <summary class="tree-summary">${keyHtml}<span class="tree-badge">${escapeHtml(countLabel)}</span></summary>
    <div class="tree-children">${childrenHtml}</div>
  </details>`;
}

export function parseCsvRows(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(field);
      field = '';
    } else if (ch === '\n') {
      currentRow.push(field);
      rows.push(currentRow);
      currentRow = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || currentRow.length > 0) {
    currentRow.push(field);
    rows.push(currentRow);
  }

  // Drop trailing blank line if empty
  if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }

  return rows;
}

export function renderStructured(
  source: string,
  format: FileFormat,
  options: {
    fileName?: string;
    view?: 'tree' | 'code';
    csvFilter?: string;
  } = {}
): StructuredRenderResult {
  const view = options.view ?? 'tree';

  if (format === 'json') {
    const isJsonc = (options.fileName ?? '').toLowerCase().endsWith('.jsonc');
    try {
      const normalized = isJsonc ? stripJsonComments(source) : source;
      const parsed = JSON.parse(normalized);
      const outline: OutlineItem[] = [];
      if (view === 'code') {
        const pretty = JSON.stringify(parsed, null, 2);
        const { html } = highlightCode(pretty, 'json');
        return {
          html: `<div class="structured-code"><pre><code class="hljs language-json">${html}</code></pre></div>`,
          outline,
          valid: true,
          summary: 'Valid JSON'
        };
      }
      const treeHtml = renderTreeNode(null, parsed, '$', 0, outline);
      return {
        html: `<div class="structured-toolbar"><span class="status-pill valid">Valid ${
          isJsonc ? 'JSONC' : 'JSON'
        }</span><div class="structured-actions"><button type="button" class="mini-btn" data-tree-action="expand">Expand all</button><button type="button" class="mini-btn" data-tree-action="collapse">Collapse all</button></div></div><div class="structured-tree">${treeHtml}</div>`,
        outline,
        valid: true,
        summary: `Valid ${isJsonc ? 'JSONC' : 'JSON'}`
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const { html } = highlightCode(source, 'json');
      return {
        html: `<div class="structured-error"><strong>JSON Syntax Error:</strong> ${escapeHtml(
          msg
        )}</div><div class="structured-code"><pre><code class="hljs language-json">${html}</code></pre></div>`,
        outline: [],
        valid: false,
        errorMessage: msg,
        summary: 'Invalid JSON'
      };
    }
  }

  if (format === 'yaml') {
    try {
      const docs: unknown[] = [];
      yaml.loadAll(source, (doc) => {
        docs.push(doc);
      });
      const outline: OutlineItem[] = [];
      if (view === 'code') {
        const { html } = highlightCode(source, 'yaml');
        return {
          html: `<div class="structured-code"><pre><code class="hljs language-yaml">${html}</code></pre></div>`,
          outline,
          valid: true,
          summary: docs.length > 1 ? `Valid YAML (${docs.length} docs)` : 'Valid YAML'
        };
      }

      const bodyHtml =
        docs.length <= 1
          ? renderTreeNode(null, docs[0] ?? null, '$', 0, outline)
          : docs
              .map(
                (doc, idx) =>
                  `<div class="yaml-doc-block"><div class="yaml-doc-badge">Document ${
                    idx + 1
                  }</div>${renderTreeNode(null, doc, `$[${idx}]`, 0, outline)}</div>`
              )
              .join('');

      return {
        html: `<div class="structured-toolbar"><span class="status-pill valid">Valid YAML${
          docs.length > 1 ? ` · ${docs.length} docs` : ''
        }</span><div class="structured-actions"><button type="button" class="mini-btn" data-tree-action="expand">Expand all</button><button type="button" class="mini-btn" data-tree-action="collapse">Collapse all</button></div></div><div class="structured-tree">${bodyHtml}</div>`,
        outline,
        valid: true,
        summary: docs.length > 1 ? `Valid YAML (${docs.length} docs)` : 'Valid YAML'
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const { html } = highlightCode(source, 'yaml');
      return {
        html: `<div class="structured-error"><strong>YAML Syntax Error:</strong> ${escapeHtml(
          msg
        )}</div><div class="structured-code"><pre><code class="hljs language-yaml">${html}</code></pre></div>`,
        outline: [],
        valid: false,
        errorMessage: msg,
        summary: 'Invalid YAML'
      };
    }
  }

  if (format === 'csv') {
    const isTsv = (options.fileName ?? '').toLowerCase().endsWith('.tsv');
    const rows = parseCsvRows(source, isTsv ? '\t' : ',');
    if (rows.length === 0) {
      return {
        html: `<div class="empty-inline">Empty ${isTsv ? 'TSV' : 'CSV'} file</div>`,
        outline: [],
        valid: true,
        summary: '0 rows'
      };
    }
    const headers = rows[0];
    const dataRows = rows.slice(1);
    const filter = (options.csvFilter ?? '').trim().toLowerCase();
    const filtered = filter
      ? dataRows.filter((row) => row.some((cell) => cell.toLowerCase().includes(filter)))
      : dataRows;
    const capped = filtered.slice(0, 500);

    const headHtml = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
    const rowsHtml = capped
      .map(
        (r) =>
          `<tr>${headers.map((_, idx) => `<td>${escapeHtml(r[idx] ?? '')}</td>`).join('')}</tr>`
      )
      .join('');
    const truncatedNotice =
      filtered.length > 500
        ? `<div class="csv-note">Showing first 500 of ${filtered.length} rows</div>`
        : '';

    return {
      html: `<div class="structured-toolbar"><span class="status-pill valid">${
        filtered.length
      } rows · ${headers.length} columns</span><input type="search" class="csv-filter-input" id="csv-filter-input" placeholder="Filter rows…" value="${escapeHtml(
        options.csvFilter ?? ''
      )}" /></div><div class="csv-wrap"><table class="csv-table"><thead><tr>${headHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></div>${truncatedNotice}`,
      outline: headers.map((h, idx) => ({ id: `col-${idx}`, text: h || `Column ${idx + 1}`, level: 1 })),
      valid: true,
      summary: `${dataRows.length} rows`
    };
  }

  if (format === 'toml') {
    const outline: OutlineItem[] = [];
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const renderedLines = lines.map((line, i) => {
      const secMatch = line.match(/^\s*\[+([^\]]+)\]+\s*$/);
      if (secMatch) {
        const id = `sec-${i}`;
        outline.push({ id, text: secMatch[1].trim(), level: 1 });
        return `<span id="${id}">${highlightCode(line, 'ini').html}</span>`;
      }
      return highlightCode(line, 'ini').html;
    });
    return {
      html: `<div class="structured-code"><pre><code class="hljs language-ini">${renderedLines.join(
        '\n'
      )}</code></pre></div>`,
      outline,
      valid: true,
      summary: `${outline.length} sections`
    };
  }

  // Plain text / log
  return {
    html: `<div class="plain-text-view">${escapeHtml(source)}</div>`,
    outline: [],
    valid: true,
    summary: 'Plain text'
  };
}

export function formatJsonText(source: string, fileName?: string, minify = false): string {
  const isJsonc = (fileName ?? '').toLowerCase().endsWith('.jsonc');
  const parsed = JSON.parse(isJsonc ? stripJsonComments(source) : source);
  return minify ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2) + '\n';
}

export function formatYamlText(source: string): string {
  const docs: unknown[] = [];
  yaml.loadAll(source, (d) => docs.push(d));
  if (docs.length <= 1) {
    return yaml.dump(docs[0] ?? null, { indent: 2, lineWidth: 100, noRefs: true });
  }
  return docs
    .map((d) => yaml.dump(d, { indent: 2, lineWidth: 100, noRefs: true }))
    .join('---\n');
}
