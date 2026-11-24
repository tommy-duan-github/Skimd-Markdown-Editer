import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeStats,
  detectFormat,
  formatBytes,
  getFormatLabel
} from '../src/lib/formats.ts';
import { htmlStringToMarkdown } from '../src/lib/htmlToMarkdown.ts';
import {
  findOnlineImageUrls,
  isOnlineImageUrl,
  replaceImageUrlInMarkdown
} from '../src/lib/imageLocalise.ts';
import {
  extractFrontmatter,
  renderMarkdown,
  resolveAssetUrl,
  toggleMarkdownTask
} from '../src/lib/markdown.ts';
import {
  formatJsonText,
  formatYamlText,
  parseCsvRows,
  renderStructured,
  stripJsonComments
} from '../src/lib/structured.ts';
import {
  BUILTIN_THEME_COLORS,
  deriveCustomThemeVars,
  deriveHighlightOverrideVars,
  getContrastText,
  isLightColor,
  normalizeThemeId
} from '../src/lib/theme.ts';

test('detectFormat maps supported extensions accurately', () => {
  assert.equal(detectFormat('README.md'), 'markdown');
  assert.equal(detectFormat('notes.markdown'), 'markdown');
  assert.equal(detectFormat('config.yaml'), 'yaml');
  assert.equal(detectFormat('docker.yml'), 'yaml');
  assert.equal(detectFormat('tsconfig.jsonc'), 'json');
  assert.equal(detectFormat('data.csv'), 'csv');
  assert.equal(detectFormat('Cargo.toml'), 'toml');
  assert.equal(detectFormat('notes.log'), 'text');
  assert.equal(getFormatLabel('json', 'tsconfig.jsonc'), 'JSONC');
});

test('computeStats and formatBytes calculate document metrics', () => {
  const stats = computeStats('Hello world\nSecond line here');
  assert.equal(stats.words, 5);
  assert.equal(stats.lines, 2);
  assert.equal(stats.readMinutes, 1);
  assert.equal(formatBytes(2048), '2.0 KB');
});

test('extractFrontmatter parses YAML metadata cleanly', () => {
  const md = '---\ntitle: Fast Doc\ntags: [a, b]\n---\n\n# Heading';
  const { frontmatter, body, rawFrontmatter } = extractFrontmatter(md);
  assert.equal(frontmatter.length, 2);
  assert.equal(frontmatter[0].key, 'title');
  assert.equal(frontmatter[0].value, 'Fast Doc');
  assert.equal(frontmatter[1].value, 'a, b');
  assert.match(body, /^# Heading/);
  assert.equal(rawFrontmatter, '---\ntitle: Fast Doc\ntags: [a, b]\n---\n\n');
});

test('renderMarkdown builds outline, callouts, and rewrites relative images', () => {
  const md = `# Title\n\n## Sub Section\n\n> [!TIP]\n> Fast reading.\n\n![Logo](../assets/logo.png)\n`;
  const res = renderMarkdown(md, { docDir: 'C:\\Docs\\Project' });
  assert.equal(res.outline.length, 2);
  assert.equal(res.outline[0].id, 'title');
  assert.equal(res.outline[1].id, 'sub-section');
  assert.match(res.html, /class="callout callout-tip"/);
  assert.match(
    res.html,
    /https:\/\/skimd-asset\.local\/file\?path=C%3A%5CDocs%5Cassets%5Clogo\.png/
  );
  assert.match(res.html, /data-orig-src="\.\.\/assets\/logo\.png"/);
  assert.equal(resolveAssetUrl('https://example.com/a.png', 'C:\\Docs'), 'https://example.com/a.png');
});

test('toggleMarkdownTask toggles checkboxes outside code fences', () => {
  const src = [
    '- [ ] First task',
    '```md',
    '- [ ] Inside fence',
    '```',
    '- [x] Second task'
  ].join('\n');

  const afterToggle0 = toggleMarkdownTask(src, 0);
  assert.match(afterToggle0, /^- \[x\] First task/m);
  assert.match(afterToggle0, /^- \[ \] Inside fence/m);

  const afterToggle1 = toggleMarkdownTask(afterToggle0, 1);
  assert.match(afterToggle1, /^- \[ \] Second task/m);
});

test('stripJsonComments and renderStructured handle JSONC, YAML, and CSV', () => {
  const jsonc = '{\n // comment\n "port": 8080,\n "ok": true,\n}';
  const cleaned = stripJsonComments(jsonc);
  assert.equal(JSON.parse(cleaned).port, 8080);

  const jsonRes = renderStructured(jsonc, 'json', { fileName: 'settings.jsonc', view: 'tree' });
  assert.equal(jsonRes.valid, true);
  assert.equal(jsonRes.outline.length, 2);

  const yamlRes = renderStructured('name: Skimd\n---\nsecond: doc', 'yaml', { view: 'tree' });
  assert.equal(yamlRes.valid, true);
  assert.match(yamlRes.summary, /2 docs/);

  const badYaml = renderStructured('a: [1, 2', 'yaml');
  assert.equal(badYaml.valid, false);
  assert.ok(badYaml.errorMessage);

  const rows = parseCsvRows('name,note\n"Alice","Line, 1"\nBob,Plain', ',');
  assert.equal(rows.length, 3);
  assert.equal(rows[1][1], 'Line, 1');

  assert.equal(formatJsonText('{"a":1}', 'a.json', true), '{"a":1}');
  assert.match(formatYamlText('b:  2\na:  1'), /b: 2/);
});

test('theme helpers normalize legacy IDs, compute contrast, and derive custom theme vars', () => {
  assert.equal(normalizeThemeId('obsidian'), 'graphite');
  assert.equal(normalizeThemeId('midnight'), 'black');
  assert.equal(normalizeThemeId('paper'), 'light');
  assert.equal(normalizeThemeId('custom'), 'custom');

  assert.equal(isLightColor('#121212'), false);
  assert.equal(isLightColor('#f3f3f3'), true);
  assert.equal(getContrastText('#ffffff'), '#141414');
  assert.equal(getContrastText('#121212'), '#ffffff');

  const vars = deriveCustomThemeVars({
    bgBase: '#121212',
    bgSurface: '#1c1c1c',
    bgElevated: '#282828',
    textPrimary: '#f5f5f5',
    accent: '#ffffff'
  });
  assert.equal(vars['color-scheme'], 'dark');
  assert.equal(vars['--bg-base'], '#121212');
  assert.equal(vars['--on-accent'], '#141414');
  assert.equal(vars['--tip-accent'], '#ffffff');

  const emptyOverrides = deriveHighlightOverrideVars('#121212', '#f5f5f5', '', '');
  assert.deepEqual(emptyOverrides, {});

  const colored = deriveHighlightOverrideVars('#f3f3f3', '#141414', '#e11d48', '#2563eb');
  assert.equal(colored['--hljs-str'], '#e11d48');
  assert.equal(colored['--tip-accent'], '#2563eb');
  assert.equal(colored['--tip-on-accent'], '#ffffff');
  assert.equal(BUILTIN_THEME_COLORS.light.bgBase, '#f3f3f3');
});

test('htmlStringToMarkdown round-trips rendered Markdown blocks, callouts, images, and frontmatter', () => {
  const source = [
    '---',
    'title: Preview Edit Test',
    '---',
    '',
    '# Heading One',
    '',
    'Paragraph with **bold**, *italic*, ~~strike~~, and `inline`.',
    '',
    '- [x] Done task',
    '- [ ] Pending task',
    '',
    '> [!WARNING]',
    '> Watch out.',
    '',
    '```yaml',
    'mode: flat',
    '```',
    '',
    '| Col A | Col B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '![Diagram](./img/arch.png)'
  ].join('\n');

  const rendered = renderMarkdown(source, { docDir: 'C:\\Workspace' });
  const roundTripped = htmlStringToMarkdown(rendered.html, rendered.rawFrontmatter);

  assert.match(roundTripped, /^---\ntitle: Preview Edit Test\n---/);
  assert.match(roundTripped, /# Heading One/);
  assert.match(roundTripped, /Paragraph with \*\*bold\*\*, \*italic\*, ~~strike~~, and `inline`\./);
  assert.match(roundTripped, /- \[x\] Done task/);
  assert.match(roundTripped, /- \[ \] Pending task/);
  assert.match(roundTripped, /> \[!WARNING\]\n> Watch out\./);
  assert.match(roundTripped, /```yaml\nmode: flat\n```/);
  assert.match(roundTripped, /\| Col A \| Col B \|/);
  assert.match(roundTripped, /!\[Diagram\]\(\.\/img\/arch\.png\)/);
});

test('imageLocalise discovers and replaces online image links while skipping code fences', () => {
  const md = [
    '# Gallery',
    '',
    '![Pic 1](https://example.com/a.png "Hero")',
    '![Local](./image/existing.png)',
    '<img src="https://cdn.example.com/b.webp" alt="B" />',
    '```md',
    '![CodeExample](https://example.com/ignored.png)',
    '```'
  ].join('\n');

  const found = findOnlineImageUrls(md);
  assert.deepEqual(found, [
    'https://example.com/a.png',
    'https://cdn.example.com/b.webp'
  ]);
  assert.equal(isOnlineImageUrl('https://skimd-asset.local/file?path=x'), false);

  let updated = replaceImageUrlInMarkdown(md, 'https://example.com/a.png', './image/a.png');
  updated = replaceImageUrlInMarkdown(
    updated,
    'https://cdn.example.com/b.webp',
    'C:/My Images/b.webp'
  );

  assert.match(updated, /!\[Pic 1\]\(\.\/image\/a\.png "Hero"\)/);
  assert.match(updated, /<img src="C:\/My Images\/b\.webp" alt="B" \/>/);
  assert.match(updated, /!\[CodeExample\]\(https:\/\/example\.com\/ignored\.png\)/);
});
