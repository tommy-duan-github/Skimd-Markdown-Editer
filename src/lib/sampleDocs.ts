export const WELCOME_DOC_CONTENT = `---
title: Welcome to Skimd
version: 1.0.0-beta.2
formats: Markdown, YAML, JSON, CSV, TOML
---

# Welcome to Skimd

**Skimd** is a minimal, fast-loading Markdown and structured-text reader designed for effortless reading and direct editing on Windows.

> [!TIP]
> Click anywhere on this page to edit Markdown directly in Preview mode, or drag and drop any \`.md\`, \`.yaml\`, \`.json\`, \`.csv\`, \`.toml\`, or \`.txt\` file onto the window.

## Core Capabilities

- **Direct Preview Editing** — Type directly in Read mode, select text for quick formatting, or switch to Split / Source mode (\`Ctrl+1\`, \`Ctrl+2\`, \`Ctrl+3\`).
- **Zero Background Indexing** — Reads only the file you open. Sibling files in the **Folder** panel load on demand without touching subdirectories.
- **Interactive Task Lists** — Click checkboxes directly in Read mode to toggle source state:
  - [x] Neutral monochrome flat Material aesthetic
  - [x] Direct inline editing in Preview mode
  - [ ] Customise your theme in Settings → Personalisation (\`Ctrl+,\`)
- **Structured Data Views** — Open \`.yaml\` or \`.json\` files to inspect collapsible node trees, copy JSON paths, validate syntax, and pretty-format.

## Keyboard Shortcuts

| Action | Shortcut |
| :--- | :--- |
| Open file | \`Ctrl+O\` |
| Save changes | \`Ctrl+S\` |
| Toggle left sidebar | \`Ctrl+B\` / \`Ctrl+\\\` |
| Read / Split / Edit | \`Ctrl+1\` / \`Ctrl+2\` / \`Ctrl+3\` |
| Find in document | \`Ctrl+F\` |
| Settings & Personalisation | \`Ctrl+,\` |
| Print / Export PDF | \`Ctrl+P\` |

## Sample Formatted Block

\`\`\`yaml
app: Skimd
philosophy:
  speed: instant
  footprint: portable
  noise: zero
supported:
  - markdown
  - yaml
  - json
\`\`\`

> [!NOTE]
> Open **Settings** (\`Ctrl+,\`) to customise your own color theme under **Personalisation**, adjust typography, or opt into Windows \`PATH\` and \`.md\` file associations later.
`;
