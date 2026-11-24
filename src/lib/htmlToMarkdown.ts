// Lightweight HTML / DOM -> GFM Markdown serializer for direct Preview editing.
// Provides both a live DOM element serializer (browser) and a pure HTML string serializer (tests).

export interface SimpleNode {
  nodeType: number; // 1 = element, 3 = text
  tagName?: string;
  textContent?: string | null;
  attributes?: Record<string, string> | { length: number };
  childNodes: ArrayLike<SimpleNode>;
  classList?: { contains(c: string): boolean };
  getAttribute?(name: string): string | null;
}

const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'];

function getAttrMap(node: SimpleNode): Record<string, string> | undefined {
  if (!node.attributes) return undefined;
  return typeof (node.attributes as NamedNodeMap).item === 'function'
    ? undefined
    : (node.attributes as Record<string, string>);
}

function hasClass(node: SimpleNode, cls: string): boolean {
  if (node.classList) return node.classList.contains(cls);
  const raw = getAttrMap(node)?.class ?? '';
  return raw.split(/\s+/).includes(cls);
}

function getAttr(node: SimpleNode, name: string): string {
  if (typeof node.getAttribute === 'function') {
    return node.getAttribute(name) ?? '';
  }
  return getAttrMap(node)?.[name] ?? '';
}

function childrenOf(node: SimpleNode): SimpleNode[] {
  return Array.from(node.childNodes);
}

function serializeChildrenInline(node: SimpleNode): string {
  return childrenOf(node).map((child) => serializeInline(child)).join('');
}

function serializeInline(node: SimpleNode): string {
  if (node.nodeType === 3) {
    return (node.textContent ?? '').replace(/\u00a0/g, ' ');
  }
  if (node.nodeType !== 1) return '';

  const tag = (node.tagName ?? '').toLowerCase();
  if (hasClass(node, 'heading-anchor') || hasClass(node, 'code-block-header')) {
    return '';
  }

  if (tag === 'br') return '\n';

  if (tag === 'input' && getAttr(node, 'type').toLowerCase() === 'checkbox') {
    const map = getAttrMap(node);
    const checked = Boolean(
      (node as unknown as HTMLInputElement).checked ||
        (map && 'checked' in map)
    );
    return checked ? '[x] ' : '[ ] ';
  }

  if (tag === 'img') {
    const src = getAttr(node, 'data-orig-src') || getAttr(node, 'src');
    const alt = getAttr(node, 'alt');
    const title = getAttr(node, 'title');
    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
  }

  if (tag === 'code') {
    const text = collectPlainText(node);
    if (text.includes('`')) {
      return `\`\` ${text} \`\``;
    }
    return `\`${text}\``;
  }

  const inner = serializeChildrenInline(node);

  if (tag === 'strong' || tag === 'b') {
    if (!inner.trim()) return inner;
    return `**${inner}**`;
  }
  if (tag === 'em' || tag === 'i') {
    if (!inner.trim()) return inner;
    return `*${inner}*`;
  }
  if (tag === 'del' || tag === 's' || tag === 'strike') {
    if (!inner.trim()) return inner;
    return `~~${inner}~~`;
  }
  if (tag === 'a') {
    const href = getAttr(node, 'href');
    return href ? `[${inner}](${href})` : inner;
  }

  return inner;
}

function collectPlainText(node: SimpleNode): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1) return '';
  if ((node.tagName ?? '').toLowerCase() === 'br') return '\n';
  return childrenOf(node).map((c) => collectPlainText(c)).join('');
}

function serializeList(listNode: SimpleNode, ordered: boolean, indent: number): string {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];
  let num = 1;

  for (const child of childrenOf(listNode)) {
    if (child.nodeType !== 1 || (child.tagName ?? '').toLowerCase() !== 'li') continue;

    let inlineParts: string[] = [];
    const subLists: string[] = [];

    for (const liChild of childrenOf(child)) {
      const liTag = liChild.nodeType === 1 ? (liChild.tagName ?? '').toLowerCase() : '';
      if (liTag === 'ul' || liTag === 'ol') {
        subLists.push(serializeList(liChild, liTag === 'ol', indent + 1));
      } else if (liTag === 'p') {
        inlineParts.push(serializeChildrenInline(liChild).trim());
      } else {
        inlineParts.push(serializeInline(liChild));
      }
    }

    const prefix = ordered ? `${num++}. ` : '- ';
    const text = inlineParts
      .join('')
      .replace(/^\s+/, '')
      .replace(/^(\[[ xX]\])\s+/, '$1 ')
      .trimEnd();
    lines.push(`${pad}${prefix}${text}`);
    for (const sub of subLists) {
      if (sub) lines.push(sub);
    }
  }

  return lines.join('\n');
}

function serializeTable(tableNode: SimpleNode): string {
  const rows: string[][] = [];
  const collectRows = (n: SimpleNode) => {
    for (const c of childrenOf(n)) {
      if (c.nodeType !== 1) continue;
      const t = (c.tagName ?? '').toLowerCase();
      if (t === 'tr') {
        const cells: string[] = [];
        for (const cell of childrenOf(c)) {
          if (cell.nodeType !== 1) continue;
          const ct = (cell.tagName ?? '').toLowerCase();
          if (ct === 'th' || ct === 'td') {
            cells.push(
              serializeChildrenInline(cell).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim()
            );
          }
        }
        if (cells.length > 0) rows.push(cells);
      } else {
        collectRows(c);
      }
    }
  };
  collectRows(tableNode);
  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((r) => r.length));
  const formatRow = (r: string[]) =>
    `| ${Array.from({ length: colCount }, (_, i) => r[i] ?? '').join(' | ')} |`;
  const sep = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`;

  const out = [formatRow(rows[0]), sep];
  for (let i = 1; i < rows.length; i++) {
    out.push(formatRow(rows[i]));
  }
  return out.join('\n');
}

function serializeBlock(node: SimpleNode): string {
  if (node.nodeType === 3) {
    const txt = (node.textContent ?? '').replace(/\u00a0/g, ' ').trim();
    return txt;
  }
  if (node.nodeType !== 1) return '';

  const tag = (node.tagName ?? '').toLowerCase();

  if (hasClass(node, 'heading-anchor') || hasClass(node, 'code-block-header')) {
    return '';
  }

  // Headings
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1]);
    const text = serializeChildrenInline(node).trim();
    return text ? `${'#'.repeat(level)} ${text}` : '';
  }

  // Horizontal rule
  if (tag === 'hr') return '---';

  // Fenced Code Block wrapper
  if (hasClass(node, 'code-block')) {
    const langNode = findFirst(node, (n) => hasClass(n, 'code-lang'));
    const codeNode = findFirst(node, (n) => (n.tagName ?? '').toLowerCase() === 'code');
    const lang = langNode ? collectPlainText(langNode).trim() : '';
    const langSuffix = lang && lang !== 'text' ? lang : '';
    const code = codeNode ? collectPlainText(codeNode).replace(/\n$/, '') : '';
    return `\`\`\`${langSuffix}\n${code}\n\`\`\``;
  }

  if (tag === 'pre') {
    const codeNode = findFirst(node, (n) => (n.tagName ?? '').toLowerCase() === 'code') ?? node;
    const cls = getAttr(codeNode, 'class');
    const langMatch = cls.match(/language-([^\s]+)/);
    const lang = langMatch && langMatch[1] !== 'text' ? langMatch[1] : '';
    const code = collectPlainText(codeNode).replace(/\n$/, '');
    return `\`\`\`${lang}\n${code}\n\`\`\``;
  }

  // GitHub Callouts
  if (hasClass(node, 'callout')) {
    const kind =
      CALLOUT_KINDS.find((k) => hasClass(node, `callout-${k}`)) ?? 'note';
    const bodyNode = findFirst(node, (n) => hasClass(n, 'callout-body'));
    const innerMd = bodyNode
      ? serializeBlocks(bodyNode)
      : serializeBlocks(node);
    const lines = innerMd.split('\n').map((l) => (l ? `> ${l}` : '>'));
    return `> [!${kind.toUpperCase()}]\n${lines.join('\n')}`;
  }

  if (tag === 'blockquote') {
    const inner = serializeBlocks(node);
    return inner
      .split('\n')
      .map((l) => (l ? `> ${l}` : '>'))
      .join('\n');
  }

  if (tag === 'ul' || tag === 'ol') {
    return serializeList(node, tag === 'ol', 0);
  }

  if (tag === 'table') {
    return serializeTable(node);
  }

  if (tag === 'p' || tag === 'div') {
    const hasBlockChildren = childrenOf(node).some(
      (c) =>
        c.nodeType === 1 &&
        /^(p|div|h[1-6]|ul|ol|blockquote|pre|table|hr)$/i.test(c.tagName ?? '')
    );
    if (hasBlockChildren) {
      return serializeBlocks(node);
    }
    return serializeChildrenInline(node).replace(/\n+$/, '').trim();
  }

  return serializeChildrenInline(node).trim();
}

function findFirst(node: SimpleNode, predicate: (n: SimpleNode) => boolean): SimpleNode | null {
  for (const child of childrenOf(node)) {
    if (child.nodeType === 1) {
      if (predicate(child)) return child;
      const nested = findFirst(child, predicate);
      if (nested) return nested;
    }
  }
  return null;
}

function serializeBlocks(container: SimpleNode): string {
  const blocks: string[] = [];
  for (const child of childrenOf(container)) {
    const block = serializeBlock(child);
    if (block) blocks.push(block);
  }
  return blocks.join('\n\n');
}

export function serializeElementToMarkdown(rootEl: SimpleNode, rawFrontmatter = ''): string {
  const body = serializeBlocks(rootEl).trimEnd();
  if (rawFrontmatter) {
    return `${rawFrontmatter}${body ? body + '\n' : ''}`;
  }
  return body ? `${body}\n` : '';
}

// Lightweight HTML string parser for Node unit tests (no jsdom dependency required)
export function htmlStringToMarkdown(html: string, rawFrontmatter = ''): string {
  interface MutableNode extends SimpleNode {
    childNodes: MutableNode[];
  }
  const root: MutableNode = { nodeType: 1, tagName: 'div', childNodes: [], attributes: {} };
  const stack: MutableNode[] = [root];
  const voidTags = new Set(['br', 'hr', 'img', 'input']);
  const tokenRegex = /<!--[\s\S]*?-->|<\/?([a-zA-Z0-9-]+)([^>]*)>|([^<]+)/g;

  const decodeEntities = (s: string) =>
    s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

  const parseAttrs = (raw: string): Record<string, string> => {
    const attrs: Record<string, string> = {};
    const attrRe = /([a-zA-Z0-9:-]+)(?:="([^"]*)"|='([^']*)')?/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(raw)) !== null) {
      attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
    }
    return attrs;
  };

  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(html)) !== null) {
    const [full, tagName, rawAttrs, text] = match;
    if (text !== undefined) {
      stack[stack.length - 1].childNodes.push({
        nodeType: 3,
        textContent: decodeEntities(text),
        childNodes: []
      });
      continue;
    }
    if (!tagName) continue;
    const tag = tagName.toLowerCase();
    if (full.startsWith('</')) {
      for (let i = stack.length - 1; i >= 1; i--) {
        if ((stack[i].tagName ?? '').toLowerCase() === tag) {
          stack.length = i;
          break;
        }
      }
    } else {
      const el: MutableNode = {
        nodeType: 1,
        tagName: tag,
        attributes: parseAttrs(rawAttrs ?? ''),
        childNodes: []
      };
      stack[stack.length - 1].childNodes.push(el);
      const selfClosing = full.endsWith('/>') || voidTags.has(tag);
      if (!selfClosing) {
        stack.push(el);
      }
    }
  }

  return serializeElementToMarkdown(root, rawFrontmatter);
}
