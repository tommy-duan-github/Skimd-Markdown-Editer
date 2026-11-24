import type { DocStats, FileFormat } from '../types.ts';

const EXTENSION_MAP: Record<string, FileFormat> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  '.mdown': 'markdown',
  '.mkd': 'markdown',
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.csv': 'csv',
  '.tsv': 'csv',
  '.toml': 'toml',
  '.ini': 'toml',
  '.cfg': 'toml',
  '.conf': 'toml',
  '.txt': 'text',
  '.log': 'text'
};

export const SUPPORTED_EXTENSIONS = Object.keys(EXTENSION_MAP);

export function getExtension(fileNameOrPath: string): string {
  const base = fileNameOrPath.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

export function detectFormat(fileNameOrPath: string): FileFormat {
  const ext = getExtension(fileNameOrPath);
  return EXTENSION_MAP[ext] ?? 'text';
}

export function getFormatLabel(format: FileFormat, fileName?: string): string {
  if (fileName) {
    const ext = getExtension(fileName);
    if (ext === '.jsonc') return 'JSONC';
    if (ext === '.tsv') return 'TSV';
    if (ext === '.ini' || ext === '.cfg' || ext === '.conf') return ext.slice(1).toUpperCase();
    if (ext === '.log') return 'LOG';
  }
  switch (format) {
    case 'markdown':
      return 'MD';
    case 'json':
      return 'JSON';
    case 'yaml':
      return 'YAML';
    case 'csv':
      return 'CSV';
    case 'toml':
      return 'TOML';
    case 'text':
      return 'TXT';
  }
}

export function computeStats(content: string): DocStats {
  if (!content) {
    return { words: 0, lines: 1, chars: 0, readMinutes: 1 };
  }
  const chars = content.length;
  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lines++;
  }
  const trimmed = content.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const readMinutes = Math.max(1, Math.ceil(words / 230));
  return { words, lines, chars, readMinutes };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
