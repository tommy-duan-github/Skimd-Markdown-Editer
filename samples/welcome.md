---
title: Skimd Architecture Notes
author: Skimd Prototype
tags: [markdown, portable, windows]
---

# Skimd Sample Document

Welcome to **Skimd** — a lightweight, instant-loading Markdown reader built for speed and visual clarity.

> [!IMPORTANT]
> Skimd reads only the files you open. Nothing is crawled or indexed in the background.

## Features Tested Here

- [x] YAML frontmatter pill bar
- [x] GitHub-flavored tables & callouts
- [ ] Click this checkbox in Read mode to toggle it in source

### Sample Code Block

```typescript
export function greet(name: string): string {
  return `Skimming fast with ${name}`;
}
```

| Format | Support | Tree View |
| :--- | :--- | :--- |
| Markdown | Full GFM + Edit | Outline |
| YAML / JSON | Highlight + Validation | Interactive Tree |
| CSV / TSV | Sticky Table + Filter | Column Outline |
