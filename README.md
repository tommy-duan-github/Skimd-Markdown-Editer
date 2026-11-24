# Skimd

**Skimd** (`v1.0.0-beta.2`) is a lightweight, fast-loading, minimal Markdown and structured-text reader for Windows.

## Features

- **Instant Startup & Low Footprint**: Native WinForms + Microsoft Edge WebView2 host (`Skimd.exe`) paired with a compact, zero-framework TypeScript UI (~8 MB runtime memory, <1.3 MB bundle).
- **Zero Background Indexing**: Opens any file immediately without scanning folders in the background. The Folder panel loads sibling files on demand only when opened.
- **Read, Split & Edit Modes**: Clean GFM Markdown rendering (tables, task checkboxes, callouts, syntax highlighting, frontmatter metadata pill), direct inline editing in **Preview**, and a resizable/swappable **Split** view.
- **Image Localisation**: Right-click any online linked image to download and rewrite it locally (`./image/` beside the `.md` file by default, or a configured global folder in Settings), or right-click a `.md` file / document → **More Tools → Localise all images**.
- **Structured Text Support**:
  - **JSON / JSONC & YAML**: Interactive collapsible tree in Read/Preview, raw code with pretty-format in Edit/Split.
  - **CSV / TSV**: Sticky-header table with live row filtering.
  - **TOML / INI / TXT / LOG**: Clean highlighted reading view with section outline.
- **Hideable Left Sidebar (`Ctrl+B` / `Ctrl+\`)**: Open, New, Outline, Recent Files, on-demand Folder view, and Settings.
- **Personalisation (`Ctrl+,`)**: Neutral monochrome defaults (`Graphite`, `True Black`, `Clean Light`, `Match System`), custom theme studio, and configurable code & `[!TIP]` highlight colors.

## Portable Build

```powershell
npm.cmd install
powershell -ExecutionPolicy Bypass -File scripts/build-portable.ps1
```

Produces the self-contained portable folder at `dist/Skimd/` (`Skimd.exe`, `app/`, WebView2 loader DLLs, and `portable.flag` so config stays in `dist/Skimd/data/config.json`).

## Windows Installer & Upgrades (`v1.0.0-beta.2`)

Build the single-file installer:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-installer.ps1
```

This emits `dist/Skimd-Setup-1.0.0-beta.2.exe`.

- **Fresh Install**: Installs to `%LOCALAPPDATA%\Programs\Skimd` (customizable), registers `Uninstall.exe` in Windows Apps & Features, and applies selected options (`PATH`, `.md` / `.yaml` / `.json` associations, Start Menu/Desktop shortcuts). Installed builds store user config in `%LOCALAPPDATA%\Skimd\config.json`.
- **Upgrading Future Builds**: Bump `"version"` in `package.json`, run `npm.cmd run build:installer`, and run the new `Skimd-Setup-<version>.exe`. The installer detects the existing installation, stops any running `Skimd.exe`, replaces `Skimd.exe` and `app/` cleanly, preserves your settings & recent files, and updates the version in Windows Apps.
- **Silent Install / Uninstall**: Supports `--silent` (or `/S`) and `--uninstall`.
