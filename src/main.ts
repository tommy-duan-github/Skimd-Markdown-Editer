import './styles/fonts.css';
import './styles/tokens.css';
import './styles/app.css';
import './styles/prose.css';

import DOMPurify from 'dompurify';
import { bridge } from './lib/bridge.ts';
import {
  computeStats,
  detectFormat,
  escapeHtml,
  formatBytes
} from './lib/formats.ts';
import {
  findOnlineImageUrls,
  isOnlineImageUrl,
  replaceImageUrlInMarkdown
} from './lib/imageLocalise.ts';
import { serializeElementToMarkdown } from './lib/htmlToMarkdown.ts';
import {
  registerSanitizer,
  renderMarkdown,
  resolveAssetUrl,
  toggleMarkdownTask
} from './lib/markdown.ts';
import { WELCOME_DOC_CONTENT } from './lib/sampleDocs.ts';
import {
  formatJsonText,
  formatYamlText,
  renderStructured
} from './lib/structured.ts';
import { applyThemeToDocument, normalizeThemeId } from './lib/theme.ts';
import {
  DEFAULT_CUSTOM_THEME,
  DEFAULT_SETTINGS,
  type AppSettings,
  type DirEntry,
  type OpenTab,
  type OutlineItem,
  type RecentEntry,
  type SidebarTab,
  type ViewMode,
  type WindowsStatus
} from './types.ts';
import { SkimdContextMenu } from './ui/contextMenu.ts';
import { SkimdDropdown } from './ui/dropdown.ts';
import { EditorPane } from './ui/editor.ts';
import { FindBar } from './ui/findBar.ts';
import {
  ICON_FIND,
  ICON_SAVE,
  ICON_SIDEBAR,
  SKIMD_LOGO_SVG
} from './ui/icons.ts';
import { SettingsModal } from './ui/settings.ts';
import { SidebarView } from './ui/sidebar.ts';

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
});

registerSanitizer((dirty) =>
  DOMPurify.sanitize(dirty, {
    ADD_ATTR: [
      'data-task-index',
      'data-code-copy',
      'data-orig-src',
      'contenteditable',
      'target',
      'rel',
      'loading'
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
  })
);

class SkimdApp {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  private recent: RecentEntry[] = [];
  private tabs: OpenTab[] = [];
  private activeTabId = '';
  private viewMode: ViewMode = 'read';
  private outline: OutlineItem[] = [];
  private folderEntries: DirEntry[] = [];
  private folderCacheDir = '';
  private folderLoading = false;
  private csvFilter = '';
  private activeRawFrontmatter = '';
  private splitRatio = 50; // percentage of first pane in split mode
  private lastWindowTitle = '';
  private lastNativeThemeKey = '';
  private windowsStatus: WindowsStatus = {
    exePath: '',
    exeDir: '',
    inUserPath: false,
    mdRegisteredToSkimd: false,
    mdUserChoiceProgId: '',
    mdLockedByOtherApp: false,
    structuredRegistered: false
  };

  private sidebar!: SidebarView;
  private editor!: EditorPane;
  private settingsModal!: SettingsModal;
  private findBar!: FindBar;
  private contextMenu!: SkimdContextMenu;

  private docTitleEl!: HTMLElement;
  private dirtyDotEl!: HTMLElement;
  private tabBarEl!: HTMLElement;
  private panesEl!: HTMLElement;
  private editorPaneEl!: HTMLElement;
  private previewPaneEl!: HTMLElement;
  private splitDividerEl!: HTMLElement;
  private previewContainerEl!: HTMLElement;
  private previewToolbarEl!: HTMLElement;
  private modeDropdown!: SkimdDropdown;
  private statusLeftEl!: HTMLElement;
  private statusRightEl!: HTMLElement;
  private statusBarEl!: HTMLElement;
  private noticeBannerEl!: HTMLElement;
  private noticeTextEl!: HTMLElement;
  private saveBtn!: HTMLButtonElement;
  private sidebarToggleBtn!: HTMLButtonElement;
  private dropOverlayEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private toastTimer: number | null = null;
  private renderTimer: number | null = null;
  private previewSyncTimer: number | null = null;
  private configSaveTimer: number | null = null;

  async init(): Promise<void> {
    this.mountShell();
    this.bindGlobalEvents();

    const readyData = await bridge.ready();
    const rawSettings = readyData.config.settings ?? {};
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...rawSettings,
      theme: normalizeThemeId(rawSettings.theme),
      customTheme: {
        ...DEFAULT_CUSTOM_THEME,
        ...(rawSettings.customTheme ?? {})
      }
    };
    this.recent = Array.isArray(readyData.config.recent) ? readyData.config.recent : [];
    this.windowsStatus = readyData.windowsStatus;
    this.viewMode = this.settings.defaultMode;

    this.applyThemeAndTypography();
    this.sidebar.setCollapsed(!this.settings.sidebarOpen);
    this.sidebarToggleBtn.classList.toggle('active', this.settings.sidebarOpen);
    this.editor.setWordWrap(this.settings.wordWrap);
    this.statusBarEl.classList.toggle('hidden', !this.settings.showStatusBar);
    this.applySplitLayout();

    if (readyData.startupFiles && readyData.startupFiles.length > 0) {
      for (const filePath of readyData.startupFiles) {
        await this.openFileByPath(filePath);
      }
    }

    if (this.tabs.length === 0) {
      this.openWelcomeDoc();
    }

    bridge.on('openFile', async (payload) => {
      const data = payload as { paths?: string[] };
      if (Array.isArray(data?.paths)) {
        for (const p of data.paths) {
          await this.openFileByPath(p);
        }
      }
    });

    bridge.on('externalFileChanged', async (payload) => {
      const data = payload as { path?: string };
      if (!data?.path) return;
      const tab = this.tabs.find(
        (t) => t.path && t.path.toLowerCase() === data.path!.toLowerCase()
      );
      if (!tab) return;

      if (this.settings.autoReload && !tab.dirty) {
        try {
          const fresh = await bridge.readFile(tab.path!);
          tab.content = fresh.content;
          tab.savedContent = fresh.content;
          tab.mtimeMs = fresh.mtimeMs;
          tab.size = fresh.size;
          tab.externalUpdateAvailable = false;
          if (tab.id === this.activeTabId) {
            this.editor.setValue(tab.content);
            this.renderDocument();
            this.updateChrome();
          }
          this.showToast(`Reloaded ${tab.name}`);
        } catch {
          // Ignore transient lock
        }
      } else {
        tab.externalUpdateAvailable = true;
        if (tab.id === this.activeTabId) {
          this.updateNoticeBanner();
        }
      }
    });

    bridge.on('windowsStatus', (payload) => {
      this.windowsStatus = payload as WindowsStatus;
      this.settingsModal.render(this.settings, this.windowsStatus, bridge.nativeHost);
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (this.settings.theme === 'system') {
        this.applyThemeAndTypography();
      }
    });
  }

  private mountShell(): void {
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <header class="topbar">
        <div class="topbar-left">
          <button type="button" class="icon-btn" id="sidebar-toggle-btn" title="Toggle sidebar (Ctrl+\\)">${ICON_SIDEBAR}</button>
          <div class="brand-mark" title="Skimd">${SKIMD_LOGO_SVG}<span>Skimd</span></div>
          <div class="doc-title-pill">
            <span class="doc-title-text" id="doc-title">Untitled</span>
            <span class="dirty-dot" id="dirty-dot" style="display:none" title="Unsaved changes"></span>
          </div>
        </div>

        <div class="topbar-right">
          <button type="button" class="icon-btn" id="save-btn" title="Save (Ctrl+S)" style="display:none">${ICON_SAVE}</button>
          <button type="button" class="icon-btn" id="find-btn" title="Find in document (Ctrl+F)">${ICON_FIND}</button>
          <div class="skimd-select-slot" id="mode-select-slot"></div>
        </div>
      </header>

      <div class="tabbar hidden" id="tabbar"></div>

      <main class="workspace">
        <aside class="sidebar collapsed" id="sidebar"></aside>
        <section class="stage">
          <div class="notice-banner hidden" id="notice-banner">
            <span id="notice-text">This file changed on disk.</span>
            <div class="notice-actions">
              <button type="button" class="mini-btn accent" id="notice-reload-btn">Reload</button>
              <button type="button" class="mini-btn" id="notice-dismiss-btn">Dismiss</button>
            </div>
          </div>
          <div id="find-bar"></div>
          <div class="panes" id="panes" data-mode="read" data-split-order="editor-left">
            <div class="editor-pane" id="editor-pane"></div>
            <div class="split-divider" id="split-divider" title="Drag to resize split">
              <button type="button" class="split-swap-btn" id="split-swap-btn" title="Swap Edit & Preview sides">⇄</button>
            </div>
            <div class="preview-pane" id="preview-pane">
              <article class="doc-container" id="doc-container"></article>
            </div>
          </div>
        </section>
      </main>

      <footer class="statusbar" id="statusbar">
        <div class="status-group">
          <span class="status-path" id="status-left" title="Click to reveal in Explorer"></span>
        </div>
        <div class="status-group">
          <span id="status-right"></span>
        </div>
      </footer>

      <div class="preview-toolbar hidden" id="preview-toolbar" role="toolbar" aria-label="Text formatting">
        <button type="button" class="preview-fmt-btn" data-fmt="bold" title="Bold (Ctrl+B)">B</button>
        <button type="button" class="preview-fmt-btn" data-fmt="italic" title="Italic (Ctrl+I)"><em>I</em></button>
        <button type="button" class="preview-fmt-btn" data-fmt="strike" title="Strikethrough"><s>S</s></button>
        <button type="button" class="preview-fmt-btn" data-fmt="code" title="Inline code">&lt;/&gt;</button>
        <button type="button" class="preview-fmt-btn" data-fmt="h2" title="Heading 2">H2</button>
        <button type="button" class="preview-fmt-btn" data-fmt="link" title="Insert link">Link</button>
      </div>

      <div id="settings-backdrop"></div>
      <div class="drop-overlay hidden" id="drop-overlay">
        <div class="drop-card">Drop file to skim in Skimd</div>
      </div>
      <div class="toast hidden" id="toast"></div>
    `;

    this.docTitleEl = document.getElementById('doc-title')!;
    this.dirtyDotEl = document.getElementById('dirty-dot')!;
    this.tabBarEl = document.getElementById('tabbar')!;
    this.panesEl = document.getElementById('panes')!;
    this.editorPaneEl = document.getElementById('editor-pane')!;
    this.previewPaneEl = document.getElementById('preview-pane')!;
    this.splitDividerEl = document.getElementById('split-divider')!;
    this.previewContainerEl = document.getElementById('doc-container')!;
    this.previewToolbarEl = document.getElementById('preview-toolbar')!;
    this.modeDropdown = new SkimdDropdown(document.getElementById('mode-select-slot')!, {
      variant: 'pill',
      ariaLabel: 'View mode',
      title: 'View mode (Ctrl+1 / 2 / 3)',
      value: this.viewMode,
      options: [
        { value: 'read', label: 'Read' },
        { value: 'split', label: 'Split' },
        { value: 'edit', label: 'Edit' }
      ],
      onChange: (val) => this.setViewMode(val as ViewMode)
    });
    this.statusLeftEl = document.getElementById('status-left')!;
    this.statusRightEl = document.getElementById('status-right')!;
    this.statusBarEl = document.getElementById('statusbar')!;
    this.noticeBannerEl = document.getElementById('notice-banner')!;
    this.noticeTextEl = document.getElementById('notice-text')!;
    this.saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
    this.sidebarToggleBtn = document.getElementById('sidebar-toggle-btn') as HTMLButtonElement;
    this.dropOverlayEl = document.getElementById('drop-overlay')!;
    this.toastEl = document.getElementById('toast')!;

    this.sidebar = new SidebarView(document.getElementById('sidebar')!, {
      onSelectTab: (tab) => this.selectSidebarTab(tab),
      onJumpOutline: (id) => this.jumpToOutlineId(id),
      onOpenPath: (path) => void this.openFileByPath(path),
      onClearRecent: () => {
        this.recent = [];
        this.scheduleConfigSave();
        this.renderSidebar();
      },
      onRemoveRecent: (path) => {
        this.recent = this.recent.filter((r) => r.path.toLowerCase() !== path.toLowerCase());
        this.scheduleConfigSave();
        this.renderSidebar();
      },
      onRefreshFolder: () => {
        this.folderCacheDir = '';
        void this.ensureFolderLoaded(true);
      },
      onOpenFile: () => void this.promptOpenFile(),
      onNewFile: () => this.createNewTab(),
      onOpenSettings: () => {
        this.settingsModal.open(this.settings, this.windowsStatus, bridge.nativeHost);
      },
      onContextMenuFile: (path, x, y) => this.showFileContextMenu(path, x, y)
    });

    this.editor = new EditorPane(
      this.editorPaneEl,
      (val) => {
        const tab = this.activeTab;
        if (!tab) return;
        tab.content = val;
        tab.dirty = tab.content !== tab.savedContent;
        tab.isWelcome = false;
        this.updateChrome();
        this.schedulePreviewRender();
      },
      () => this.formatActiveStructuredDoc()
    );

    this.findBar = new FindBar(document.getElementById('find-bar')!, () => this.previewContainerEl);
    this.contextMenu = new SkimdContextMenu();

    this.settingsModal = new SettingsModal(document.getElementById('settings-backdrop')!, {
      onUpdate: (patch) => {
        const prevEditable = this.settings.previewEditable;
        const prevSplitOrder = this.settings.splitOrder;
        const prevHidden = this.settings.showHiddenFiles;
        this.settings = { ...this.settings, ...patch };
        this.applyThemeAndTypography();
        this.editor.setWordWrap(this.settings.wordWrap);
        this.statusBarEl.classList.toggle('hidden', !this.settings.showStatusBar);
        if (prevSplitOrder !== this.settings.splitOrder) {
          this.applySplitLayout();
        }
        if (prevEditable !== this.settings.previewEditable) {
          this.renderDocument();
        }
        if (prevHidden !== this.settings.showHiddenFiles) {
          this.folderCacheDir = '';
          if (this.settings.sidebarOpen && this.settings.sidebarTab === 'folder') {
            void this.ensureFolderLoaded(true);
          }
        }
        this.scheduleConfigSave();
      },
      onRegisterWindows: async (opts) => {
        try {
          this.windowsStatus = await bridge.registerWindows(opts);
          this.settingsModal.render(this.settings, this.windowsStatus, bridge.nativeHost);
          this.showToast('Windows integration updated');
        } catch (err) {
          this.showToast(err instanceof Error ? err.message : 'Registration failed');
        }
      },
      onUnregisterWindows: async () => {
        try {
          this.windowsStatus = await bridge.unregisterWindows();
          this.settingsModal.render(this.settings, this.windowsStatus, bridge.nativeHost);
          this.showToast('Windows integration removed');
        } catch (err) {
          this.showToast(err instanceof Error ? err.message : 'Unregister failed');
        }
      },
      onOpenDefaultApps: async () => {
        await bridge.openDefaultApps();
      },
      onPickImageFolder: async () => {
        return bridge.pickFolderDialog();
      }
    });
  }

  private bindGlobalEvents(): void {
    this.sidebarToggleBtn.addEventListener('click', () => this.toggleSidebar());

    this.saveBtn.addEventListener('click', () => void this.saveActiveTab(false));
    document.getElementById('find-btn')!.addEventListener('click', () => this.findBar.open());

    // Split mode swap & drag resize
    document.getElementById('split-swap-btn')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.settings.splitOrder =
        this.settings.splitOrder === 'editor-left' ? 'preview-left' : 'editor-left';
      this.splitRatio = 100 - this.splitRatio;
      this.applySplitLayout();
      this.scheduleConfigSave();
      this.settingsModal.render(this.settings, this.windowsStatus, bridge.nativeHost);
    });

    let resizingSplit = false;
    this.splitDividerEl.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('#split-swap-btn')) return;
      resizingSplit = true;
      this.splitDividerEl.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    this.splitDividerEl.addEventListener('pointermove', (e) => {
      if (!resizingSplit || this.viewMode !== 'split') return;
      const rect = this.panesEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pctFromLeft = ((e.clientX - rect.left) / rect.width) * 100;
      const clampedLeft = Math.min(78, Math.max(22, pctFromLeft));
      this.splitRatio =
        this.settings.splitOrder === 'editor-left' ? clampedLeft : 100 - clampedLeft;
      this.applySplitLayout();
    });

    const stopResize = () => {
      if (!resizingSplit) return;
      resizingSplit = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    this.splitDividerEl.addEventListener('pointerup', stopResize);
    this.splitDividerEl.addEventListener('pointercancel', stopResize);

    this.statusLeftEl.addEventListener('click', () => {
      const tab = this.activeTab;
      if (tab?.path) void bridge.revealInExplorer(tab.path);
    });

    document.getElementById('notice-reload-btn')!.addEventListener('click', async () => {
      const tab = this.activeTab;
      if (!tab?.path) return;
      const fresh = await bridge.readFile(tab.path);
      tab.content = fresh.content;
      tab.savedContent = fresh.content;
      tab.dirty = false;
      tab.mtimeMs = fresh.mtimeMs;
      tab.size = fresh.size;
      tab.externalUpdateAvailable = false;
      this.editor.setValue(tab.content);
      this.renderDocument();
      this.updateChrome();
      this.updateNoticeBanner();
    });

    document.getElementById('notice-dismiss-btn')!.addEventListener('click', () => {
      if (this.activeTab) {
        this.activeTab.externalUpdateAvailable = false;
        this.updateNoticeBanner();
      }
    });

    // Direct Preview Editing: input sync -> Markdown source
    this.previewContainerEl.addEventListener('input', (e) => {
      const target = e.target as HTMLElement;
      if (target.id === 'csv-filter-input') {
        this.csvFilter = (target as HTMLInputElement).value;
        this.renderDocument();
        const freshInput = document.getElementById('csv-filter-input') as HTMLInputElement | null;
        if (freshInput) {
          freshInput.focus();
          freshInput.setSelectionRange(freshInput.value.length, freshInput.value.length);
        }
        return;
      }

      if (target.closest('.prose[contenteditable="true"]')) {
        this.schedulePreviewToSourceSync();
      }
    });

    // Markdown shortcut triggers & code newline handling inside Preview mode
    this.previewContainerEl.addEventListener('keydown', (e) => {
      const prose = (e.target as HTMLElement).closest<HTMLElement>('.prose[contenteditable="true"]');
      if (!prose) return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        e.stopPropagation();
        document.execCommand('bold');
        this.syncPreviewToSourceNow();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        e.stopPropagation();
        document.execCommand('italic');
        this.syncPreviewToSourceNow();
        return;
      }

      if (e.key === 'Enter') {
        const sel = window.getSelection();
        const anchorEl =
          sel?.anchorNode?.nodeType === 1
            ? (sel.anchorNode as HTMLElement)
            : sel?.anchorNode?.parentElement;
        if (anchorEl?.closest('pre code')) {
          e.preventDefault();
          document.execCommand('insertText', false, '\n');
          this.syncPreviewToSourceNow();
        }
        return;
      }

      if (e.key === ' ') {
        if (this.tryTransformMarkdownShortcut()) {
          e.preventDefault();
          this.syncPreviewToSourceNow();
        }
      }
    });

    // Floating formatting toolbar for Preview text selection
    this.previewToolbarEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    this.previewToolbarEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-fmt]');
      if (!btn) return;
      this.applyPreviewFormatting(btn.dataset.fmt ?? '');
    });

    document.addEventListener('selectionchange', () => {
      this.updatePreviewSelectionToolbar();
    });

    // Delegated interactions inside preview pane
    this.previewContainerEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      if (target.matches('input.task-checkbox')) {
        const idx = Number(target.dataset.taskIndex);
        const tab = this.activeTab;
        if (tab && !Number.isNaN(idx)) {
          tab.content = toggleMarkdownTask(tab.content, idx);
          tab.dirty = tab.content !== tab.savedContent;
          this.editor.setValue(tab.content);
          this.renderDocument();
          this.updateChrome();
        }
        return;
      }

      const copyBtn = target.closest<HTMLButtonElement>('[data-code-copy]');
      if (copyBtn) {
        const codeText =
          copyBtn.closest('.code-block')?.querySelector('pre code')?.textContent ?? '';
        void navigator.clipboard.writeText(codeText);
        const orig = copyBtn.textContent;
        copyBtn.textContent = 'Copied';
        window.setTimeout(() => {
          copyBtn.textContent = orig;
        }, 1200);
        return;
      }

      const treeAction = target.closest<HTMLElement>('[data-tree-action]');
      if (treeAction) {
        const expand = treeAction.dataset.treeAction === 'expand';
        this.previewContainerEl
          .querySelectorAll<HTMLDetailsElement>('.tree-branch')
          .forEach((d) => (d.open = expand));
        return;
      }

      const jsonKey = target.closest<HTMLElement>('[data-json-path]');
      if (jsonKey) {
        const jp = jsonKey.dataset.jsonPath ?? '';
        void navigator.clipboard.writeText(jp);
        this.showToast(`Copied path: ${jp}`);
        return;
      }

      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      if (anchor) {
        const inEditableProse = Boolean(anchor.closest('.prose[contenteditable="true"]'));
        if (inEditableProse && !(e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          return;
        }
        const href = anchor.getAttribute('href') ?? '';
        if (href.startsWith('#')) {
          e.preventDefault();
          this.jumpToOutlineId(href.slice(1));
          return;
        }
        if (/^https?:\/\//i.test(href) && !href.startsWith('https://skimd-asset.local/')) {
          e.preventDefault();
          void bridge.openExternal(href);
          return;
        }
        if (bridge.nativeHost && this.activeTab?.dir && !/^[a-z]+:/i.test(href)) {
          e.preventDefault();
          const clean = href.split('#')[0];
          const url = resolveAssetUrl(clean, this.activeTab.dir);
          const parsed = new URL(url);
          const resolvedPath = parsed.searchParams.get('path');
          if (resolvedPath) void this.openFileByPath(resolvedPath);
        }
      }
    });

    // Context menu on online images or Markdown document background
    this.previewContainerEl.addEventListener('contextmenu', (e) => {
      const target = e.target as HTMLElement;
      const img = target.closest<HTMLImageElement>('img');
      const tab = this.activeTab;

      if (img && tab && tab.format === 'markdown') {
        const origUrl = (img.getAttribute('data-orig-src') || img.getAttribute('src') || '').trim();
        if (isOnlineImageUrl(origUrl)) {
          e.preventDefault();
          this.contextMenu.show(e.clientX, e.clientY, [
            {
              label: 'Localise image',
              onClick: () => void this.localiseSingleImage(tab, origUrl)
            },
            {
              label: 'Copy image link',
              onClick: () => {
                void navigator.clipboard.writeText(origUrl);
                this.showToast('Image link copied');
              }
            },
            {
              label: 'Open in browser',
              onClick: () => void bridge.openExternal(origUrl)
            },
            { separator: true },
            {
              label: 'More Tools',
              submenu: [
                {
                  label: 'Localise all images',
                  onClick: () => void this.localiseAllImagesInTab(tab)
                }
              ]
            }
          ]);
          return;
        }
      }

      const sel = window.getSelection();
      const hasSelection = Boolean(sel && !sel.isCollapsed && sel.toString().trim().length > 0);
      if (!hasSelection && tab && tab.format === 'markdown') {
        e.preventDefault();
        this.contextMenu.show(e.clientX, e.clientY, [
          {
            label: 'More Tools',
            submenu: [
              {
                label: 'Localise all images',
                onClick: () => void this.localiseAllImagesInTab(tab)
              }
            ]
          },
          { separator: true },
          {
            label: 'Save',
            disabled: !tab.dirty && Boolean(tab.path),
            onClick: () => void this.saveActiveTab(false)
          },
          {
            label: 'Reveal in Explorer',
            disabled: !tab.path,
            onClick: () => {
              if (tab.path) void bridge.revealInExplorer(tab.path);
            }
          }
        ]);
      }
    });

    // Drag and Drop files
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragDepth++;
      this.dropOverlayEl.classList.remove('hidden');
    });
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) this.dropOverlayEl.classList.add('hidden');
    });
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragDepth = 0;
      this.dropOverlayEl.classList.add('hidden');
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      if (bridge.forwardDroppedFiles(files)) {
        return;
      }

      for (const f of Array.from(files)) {
        const content = await f.text();
        this.openInMemoryTab({
          path: null,
          name: f.name,
          dir: null,
          content,
          size: f.size,
          mtimeMs: f.lastModified
        });
      }
    });

    // Global Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (e.key === 'Escape') {
        if (this.settingsModal.opened) {
          this.settingsModal.close();
          return;
        }
        if (this.findBar.opened) {
          this.findBar.close();
          return;
        }
        this.previewToolbarEl.classList.add('hidden');
      }

      if (!ctrl) return;

      if (key === 'o') {
        e.preventDefault();
        void this.promptOpenFile();
      } else if (key === 'n') {
        e.preventDefault();
        this.createNewTab();
      } else if (key === 's') {
        e.preventDefault();
        void this.saveActiveTab(e.shiftKey);
      } else if (key === 'b' || key === '\\') {
        e.preventDefault();
        this.toggleSidebar();
      } else if (key === 'e') {
        e.preventDefault();
        const order: ViewMode[] = ['read', 'split', 'edit'];
        const next = order[(order.indexOf(this.viewMode) + 1) % order.length];
        this.setViewMode(next);
      } else if (key === '1') {
        e.preventDefault();
        this.setViewMode('read');
      } else if (key === '2') {
        e.preventDefault();
        this.setViewMode('split');
      } else if (key === '3') {
        e.preventDefault();
        this.setViewMode('edit');
      } else if (key === 'f') {
        e.preventDefault();
        this.findBar.open();
      } else if (key === ',') {
        e.preventDefault();
        this.settingsModal.open(this.settings, this.windowsStatus, bridge.nativeHost);
      } else if (key === 'w') {
        e.preventDefault();
        if (this.activeTab) this.closeTab(this.activeTab.id);
      } else if (key === 'p') {
        e.preventDefault();
        void bridge.printDocument();
      } else if (key === '=' || key === '+') {
        e.preventDefault();
        this.adjustFontSize(1);
      } else if (key === '-') {
        e.preventDefault();
        this.adjustFontSize(-1);
      }
    });
  }

  private applySplitLayout(): void {
    this.panesEl.dataset.splitOrder = this.settings.splitOrder;
    if (this.viewMode === 'split') {
      this.editorPaneEl.style.flex = `0 0 ${this.splitRatio}%`;
      this.previewPaneEl.style.flex = '1 1 0%';
    } else {
      this.editorPaneEl.style.flex = '';
      this.previewPaneEl.style.flex = '';
    }
  }

  private tryTransformMarkdownShortcut(): boolean {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode) return false;
    if (sel.anchorNode.nodeType !== 3) return false;

    const textNode = sel.anchorNode as Text;
    const block = textNode.parentElement?.closest('p, div');
    if (!block || block.closest('pre, .callout, table')) return false;

    const beforeCaret = textNode.data.slice(0, sel.anchorOffset);
    if (beforeCaret !== textNode.data.trimStart()) {
      const blockTextBefore = block.textContent?.slice(0, beforeCaret.length) ?? '';
      if (blockTextBefore !== beforeCaret) return false;
    }

    if (/^#{1,4}$/.test(beforeCaret)) {
      const level = beforeCaret.length;
      textNode.deleteData(0, beforeCaret.length);
      document.execCommand('formatBlock', false, `h${level}`);
      return true;
    }
    if (beforeCaret === '-' || beforeCaret === '*') {
      textNode.deleteData(0, beforeCaret.length);
      document.execCommand('insertUnorderedList');
      return true;
    }
    if (beforeCaret === '1.') {
      textNode.deleteData(0, beforeCaret.length);
      document.execCommand('insertOrderedList');
      return true;
    }
    if (beforeCaret === '>') {
      textNode.deleteData(0, beforeCaret.length);
      document.execCommand('formatBlock', false, 'blockquote');
      return true;
    }
    return false;
  }

  private applyPreviewFormatting(fmt: string): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    if (fmt === 'bold') {
      document.execCommand('bold');
    } else if (fmt === 'italic') {
      document.execCommand('italic');
    } else if (fmt === 'strike') {
      document.execCommand('strikeThrough');
    } else if (fmt === 'h2') {
      document.execCommand('formatBlock', false, 'h2');
    } else if (fmt === 'code') {
      const selectedText = sel.toString();
      if (selectedText) {
        const code = document.createElement('code');
        code.textContent = selectedText;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(code);
        range.setStartAfter(code);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } else if (fmt === 'link') {
      const url = window.prompt('Enter link URL:', 'https://');
      if (url) {
        document.execCommand('createLink', false, url);
      }
    }
    this.syncPreviewToSourceNow();
    this.updatePreviewSelectionToolbar();
  }

  private updatePreviewSelectionToolbar(): void {
    if (
      this.viewMode === 'edit' ||
      !this.settings.previewEditable ||
      this.activeTab?.format !== 'markdown'
    ) {
      if (!this.previewToolbarEl.classList.contains('hidden')) {
        this.previewToolbarEl.classList.add('hidden');
      }
      return;
    }
    const prose = this.previewContainerEl.querySelector('.prose[contenteditable="true"]');
    const sel = window.getSelection();
    if (!prose || !sel || sel.isCollapsed || sel.rangeCount === 0) {
      this.previewToolbarEl.classList.add('hidden');
      return;
    }
    const anchor = sel.anchorNode;
    if (!anchor || !prose.contains(anchor)) {
      this.previewToolbarEl.classList.add('hidden');
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      this.previewToolbarEl.classList.add('hidden');
      return;
    }
    this.previewToolbarEl.classList.remove('hidden');
    const tbRect = this.previewToolbarEl.getBoundingClientRect();
    const top = Math.max(52, rect.top - tbRect.height - 10);
    const left = Math.min(
      window.innerWidth - tbRect.width - 12,
      Math.max(12, rect.left + rect.width / 2 - tbRect.width / 2)
    );
    this.previewToolbarEl.style.top = `${top}px`;
    this.previewToolbarEl.style.left = `${left}px`;
  }

  private schedulePreviewToSourceSync(): void {
    if (this.previewSyncTimer !== null) window.clearTimeout(this.previewSyncTimer);
    this.previewSyncTimer = window.setTimeout(() => {
      this.previewSyncTimer = null;
      this.syncPreviewToSourceNow();
    }, 130);
  }

  private syncPreviewToSourceNow(): void {
    const tab = this.activeTab;
    const prose = this.previewContainerEl.querySelector<HTMLElement>('.prose[contenteditable="true"]');
    if (!tab || !prose || tab.format !== 'markdown') return;

    const md = serializeElementToMarkdown(prose, this.activeRawFrontmatter);
    tab.content = md;
    tab.dirty = tab.content !== tab.savedContent;
    tab.isWelcome = false;
    this.editor.setValue(tab.content);

    const liveOutline: OutlineItem[] = [];
    prose.querySelectorAll<HTMLElement>('h1, h2, h3, h4').forEach((h, idx) => {
      const level = Number(h.tagName[1]);
      if (!h.id) h.id = `heading-${idx}`;
      const clone = h.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.heading-anchor').forEach((a) => a.remove());
      liveOutline.push({
        id: h.id,
        text: (clone.textContent ?? '').trim() || 'Untitled',
        level
      });
    });
    this.outline = liveOutline;
    this.renderSidebar();
    this.updateChrome();
  }

  private get activeTab(): OpenTab | undefined {
    return this.tabs.find((t) => t.id === this.activeTabId);
  }

  private openWelcomeDoc(): void {
    this.openInMemoryTab({
      path: null,
      name: 'Welcome.md',
      dir: null,
      content: WELCOME_DOC_CONTENT,
      size: WELCOME_DOC_CONTENT.length,
      mtimeMs: Date.now(),
      isWelcome: true
    });
  }

  private createNewTab(): void {
    this.openInMemoryTab({
      path: null,
      name: 'Untitled.md',
      dir: null,
      content: '# Untitled\n\n',
      size: 12,
      mtimeMs: Date.now()
    });
    if (!this.settings.previewEditable) {
      this.setViewMode('split');
      this.editor.focus();
    }
  }

  private openInMemoryTab(data: {
    path: string | null;
    name: string;
    dir: string | null;
    content: string;
    size: number;
    mtimeMs: number;
    isWelcome?: boolean;
  }): void {
    if (!data.isWelcome && this.tabs.length === 1 && this.tabs[0].isWelcome && !this.tabs[0].dirty) {
      this.tabs = [];
    }

    const id = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const format = detectFormat(data.name);
    const tab: OpenTab = {
      id,
      path: data.path,
      name: data.name,
      dir: data.dir,
      format,
      content: data.content,
      savedContent: data.content,
      dirty: false,
      mtimeMs: data.mtimeMs,
      size: data.size,
      isWelcome: data.isWelcome
    };
    this.tabs.push(tab);
    this.activateTab(id);
  }

  async openFileByPath(filePath: string): Promise<void> {
    const existing = this.tabs.find(
      (t) => t.path && t.path.toLowerCase() === filePath.toLowerCase()
    );
    if (existing) {
      this.activateTab(existing.id);
      return;
    }

    try {
      const result = await bridge.readFile(filePath);
      this.openInMemoryTab({
        path: result.path,
        name: result.name,
        dir: result.dir,
        content: result.content,
        size: result.size,
        mtimeMs: result.mtimeMs
      });
      this.recordRecent({
        path: result.path,
        name: result.name,
        dir: result.dir,
        format: detectFormat(result.name),
        lastOpened: Date.now()
      });
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : `Cannot open ${filePath}`);
    }
  }

  private async promptOpenFile(): Promise<void> {
    const res = await bridge.openFileDialog();
    if (!res) return;

    if (res.path && bridge.nativeHost) {
      const existing = this.tabs.find(
        (t) => t.path && t.path.toLowerCase() === res.path.toLowerCase()
      );
      if (existing) {
        this.activateTab(existing.id);
        return;
      }
      this.openInMemoryTab({
        path: res.path,
        name: res.name,
        dir: res.dir,
        content: res.content,
        size: res.size,
        mtimeMs: res.mtimeMs
      });
      this.recordRecent({
        path: res.path,
        name: res.name,
        dir: res.dir,
        format: detectFormat(res.name),
        lastOpened: Date.now()
      });
    } else {
      this.openInMemoryTab({
        path: null,
        name: res.name,
        dir: null,
        content: res.content,
        size: res.size,
        mtimeMs: res.mtimeMs
      });
    }
  }

  private async saveActiveTab(saveAs: boolean): Promise<void> {
    const tab = this.activeTab;
    if (!tab) return;

    if (!saveAs && tab.path && bridge.nativeHost) {
      try {
        const res = await bridge.writeFile(tab.path, tab.content);
        tab.savedContent = tab.content;
        tab.dirty = false;
        tab.mtimeMs = res.mtimeMs;
        tab.size = res.size;
        tab.externalUpdateAvailable = false;
        this.updateChrome();
        this.showToast(`Saved ${tab.name}`);
      } catch (err) {
        this.showToast(err instanceof Error ? err.message : 'Save failed');
      }
      return;
    }

    const res = await bridge.saveFileDialog(tab.name, tab.content);
    if (!res) return;
    tab.path = bridge.nativeHost ? res.path : null;
    tab.name = res.name;
    tab.dir = res.dir || null;
    tab.format = detectFormat(res.name);
    tab.savedContent = tab.content;
    tab.dirty = false;
    tab.mtimeMs = res.mtimeMs;
    tab.size = res.size;
    tab.isWelcome = false;
    if (tab.path) {
      this.recordRecent({
        path: tab.path,
        name: tab.name,
        dir: tab.dir ?? '',
        format: tab.format,
        lastOpened: Date.now()
      });
    }
    this.renderDocument();
    this.updateChrome();
    this.showToast(`Saved ${tab.name}`);
  }

  private activateTab(id: string): void {
    this.activeTabId = id;
    this.csvFilter = '';
    const tab = this.activeTab;
    if (!tab) return;
    this.editor.setValue(tab.content);
    this.renderDocument();
    this.updateChrome();
    this.updateNoticeBanner();
    if (this.settings.sidebarOpen && this.settings.sidebarTab === 'folder') {
      void this.ensureFolderLoaded(false);
    }
  }

  private closeTab(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    this.tabs.splice(idx, 1);
    if (this.tabs.length === 0) {
      this.openWelcomeDoc();
      return;
    }
    if (this.activeTabId === id) {
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activateTab(next.id);
    } else {
      this.updateChrome();
    }
  }

  private setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.panesEl.dataset.mode = mode;
    this.modeDropdown.setValue(mode);
    this.applySplitLayout();
    if (mode === 'edit') {
      this.editor.focus();
    }
    this.updateChrome();
  }

  private toggleSidebar(): void {
    this.settings.sidebarOpen = !this.settings.sidebarOpen;
    this.sidebar.setCollapsed(!this.settings.sidebarOpen);
    this.sidebarToggleBtn.classList.toggle('active', this.settings.sidebarOpen);
    this.scheduleConfigSave();
    if (this.settings.sidebarOpen && this.settings.sidebarTab === 'folder') {
      void this.ensureFolderLoaded(false);
    } else {
      this.renderSidebar();
    }
  }

  private selectSidebarTab(tab: SidebarTab): void {
    this.settings.sidebarTab = tab;
    this.scheduleConfigSave();
    if (tab === 'folder') {
      void this.ensureFolderLoaded(false);
    } else {
      this.renderSidebar();
    }
  }

  private async ensureFolderLoaded(force: boolean): Promise<void> {
    const dir = this.activeTab?.dir ?? null;
    if (!dir) {
      this.folderEntries = [];
      this.folderCacheDir = '';
      this.renderSidebar();
      return;
    }
    if (!force && this.folderCacheDir.toLowerCase() === dir.toLowerCase()) {
      this.renderSidebar();
      return;
    }
    this.folderLoading = true;
    this.renderSidebar();
    try {
      this.folderEntries = await bridge.listDir(dir, this.settings.showHiddenFiles);
      this.folderCacheDir = dir;
    } catch {
      this.folderEntries = [];
    } finally {
      this.folderLoading = false;
      this.renderSidebar();
    }
  }

  private schedulePreviewRender(): void {
    if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.renderDocument();
    }, 90);
  }

  private renderDocument(): void {
    const tab = this.activeTab;
    if (!tab) return;

    this.previewToolbarEl.classList.add('hidden');

    if (tab.format === 'markdown') {
      const result = renderMarkdown(tab.content, { docDir: tab.dir });
      this.outline = result.outline;
      this.activeRawFrontmatter = result.rawFrontmatter;

      const fmHtml =
        result.frontmatter.length > 0
          ? `<details class="frontmatter-card"><summary>Metadata (${
              result.frontmatter.length
            })</summary><div class="frontmatter-grid">${result.frontmatter
              .map(
                (item) =>
                  `<span class="fm-key">${escapeHtml(item.key)}</span><span class="fm-val">${escapeHtml(
                    item.value
                  )}</span>`
              )
              .join('')}</div></details>`
          : '';

      const editAttrs = this.settings.previewEditable
        ? ' contenteditable="true" spellcheck="false"'
        : '';

      this.previewContainerEl.innerHTML = `${fmHtml}<div class="prose"${editAttrs}>${result.html}</div>`;
      if (this.settings.previewEditable) {
        this.previewContainerEl.querySelectorAll<HTMLAnchorElement>('.prose a[href]').forEach((a) => {
          a.title = 'Ctrl+Click to open link';
        });
      }
    } else {
      this.activeRawFrontmatter = '';
      // JSON & YAML always render in Tree mode inside Preview/Read; Edit mode is raw source code.
      const result = renderStructured(tab.content, tab.format, {
        fileName: tab.name,
        view: 'tree',
        csvFilter: this.csvFilter
      });
      this.outline = result.outline;
      this.previewContainerEl.innerHTML = result.html;
    }

    this.findBar.refresh();
    this.renderSidebar();
    this.updateStatusBar();
  }

  private formatActiveStructuredDoc(): void {
    const tab = this.activeTab;
    if (!tab) return;
    try {
      if (tab.format === 'json') {
        tab.content = formatJsonText(tab.content, tab.name, false);
      } else if (tab.format === 'yaml') {
        tab.content = formatYamlText(tab.content);
      } else {
        return;
      }
      tab.dirty = tab.content !== tab.savedContent;
      this.editor.setValue(tab.content);
      this.renderDocument();
      this.updateChrome();
      this.showToast('Formatted document');
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : 'Cannot format invalid syntax');
    }
  }

  private updateChrome(): void {
    const tab = this.activeTab;
    if (!tab) return;

    this.docTitleEl.textContent = tab.name;
    this.dirtyDotEl.style.display = tab.dirty ? 'inline-block' : 'none';

    this.saveBtn.style.display = tab.dirty ? 'inline-flex' : 'none';
    this.saveBtn.classList.toggle('primary', tab.dirty);

    const isTreeFormat = tab.format === 'json' || tab.format === 'yaml';
    this.editor.setShowFormatToolbar(isTreeFormat && this.viewMode !== 'read');

    this.modeDropdown.setValue(this.viewMode);
    this.panesEl.dataset.mode = this.viewMode;
    this.applySplitLayout();

    if (this.tabs.length > 1) {
      this.tabBarEl.classList.remove('hidden');
      this.tabBarEl.innerHTML = this.tabs
        .map(
          (t) => `<div class="tab-item${t.id === this.activeTabId ? ' active' : ''}" data-tab-id="${
            t.id
          }" title="${escapeHtml(t.path ?? t.name)}">
            ${t.dirty ? '<span class="dirty-dot"></span>' : ''}
            <span class="tab-name">${escapeHtml(t.name)}</span>
            <button type="button" class="tab-close" data-close-tab="${t.id}" title="Close (Ctrl+W)">×</button>
          </div>`
        )
        .join('');

      this.tabBarEl.querySelectorAll<HTMLElement>('[data-tab-id]').forEach((el) => {
        el.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('[data-close-tab]')) return;
          const tid = el.dataset.tabId;
          if (tid) this.activateTab(tid);
        });
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const tid = el.dataset.tabId;
          const t = this.tabs.find((item) => item.id === tid);
          if (t) this.showTabContextMenu(t, e.clientX, e.clientY);
        });
      });

      this.tabBarEl.querySelectorAll<HTMLElement>('[data-close-tab]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const tid = btn.dataset.closeTab;
          if (tid) this.closeTab(tid);
        });
      });
    } else {
      this.tabBarEl.classList.add('hidden');
      this.tabBarEl.innerHTML = '';
    }

    const titleText = `${tab.dirty ? '● ' : ''}${tab.name} — Skimd`;
    if (titleText !== this.lastWindowTitle) {
      this.lastWindowTitle = titleText;
      document.title = titleText;
      void bridge.setWindowTitle(titleText);
    }
    this.updateStatusBar();
  }

  private updateStatusBar(): void {
    const tab = this.activeTab;
    if (!tab) return;
    this.statusLeftEl.textContent = tab.path ?? (tab.isWelcome ? 'Welcome Guide' : 'Unsaved buffer');
    const stats = computeStats(tab.content);
    const sizeText = tab.size > 0 ? ` · ${formatBytes(tab.size)}` : '';
    if (tab.format === 'markdown' || tab.format === 'text') {
      this.statusRightEl.textContent = `${stats.words} words · ${stats.lines} lines · ${stats.readMinutes} min read${sizeText}`;
    } else {
      this.statusRightEl.textContent = `${stats.lines} lines${sizeText}`;
    }
  }

  private updateNoticeBanner(): void {
    const tab = this.activeTab;
    if (tab?.externalUpdateAvailable) {
      this.noticeTextEl.textContent = `${tab.name} was modified on disk.`;
      this.noticeBannerEl.classList.remove('hidden');
    } else {
      this.noticeBannerEl.classList.add('hidden');
    }
  }

  private renderSidebar(): void {
    if (!this.settings.sidebarOpen) return;
    this.sidebar.render({
      activeTab: this.settings.sidebarTab,
      outline: this.outline,
      recent: this.recent,
      activePath: this.activeTab?.path ?? null,
      activeDir: this.activeTab?.dir ?? null,
      folderEntries: this.folderEntries,
      folderLoading: this.folderLoading
    });
  }

  private jumpToOutlineId(id: string): void {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private applyThemeAndTypography(): void {
    const { isLight, bgHex } = applyThemeToDocument(document.documentElement, this.settings);
    const themeKey = `${isLight ? 'light' : 'dark'}|${bgHex}`;
    if (themeKey !== this.lastNativeThemeKey) {
      this.lastNativeThemeKey = themeKey;
      void bridge.setTheme(isLight ? 'light' : 'dark', bgHex);
    }
  }

  private adjustFontSize(delta: number): void {
    const next = Math.min(22, Math.max(13, this.settings.fontSize + delta));
    if (next === this.settings.fontSize) return;
    this.settings.fontSize = next;
    this.applyThemeAndTypography();
    this.scheduleConfigSave();
    this.showToast(`Font size: ${next}px`);
  }

  private recordRecent(entry: RecentEntry): void {
    const filtered = this.recent.filter(
      (r) => r.path.toLowerCase() !== entry.path.toLowerCase()
    );
    this.recent = [entry, ...filtered].slice(0, 20);
    this.scheduleConfigSave();
    this.renderSidebar();
  }

  private scheduleConfigSave(): void {
    if (this.configSaveTimer !== null) window.clearTimeout(this.configSaveTimer);
    this.configSaveTimer = window.setTimeout(() => {
      this.configSaveTimer = null;
      void bridge.saveConfig({
        settings: this.settings,
        recent: this.recent
      });
    }, 220);
  }

  private showToast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.remove('hidden');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.add('hidden');
    }, 2400);
  }

  private showTabContextMenu(tab: OpenTab, x: number, y: number): void {
    const items = [
      ...(tab.format === 'markdown'
        ? [
            {
              label: 'More Tools',
              submenu: [
                {
                  label: 'Localise all images',
                  onClick: () => void this.localiseAllImagesInTab(tab)
                }
              ]
            },
            { separator: true }
          ]
        : []),
      {
        label: 'Reveal in Explorer',
        disabled: !tab.path,
        onClick: () => {
          if (tab.path) void bridge.revealInExplorer(tab.path);
        }
      },
      {
        label: 'Close',
        onClick: () => this.closeTab(tab.id)
      }
    ];
    this.contextMenu.show(x, y, items);
  }

  private showFileContextMenu(filePath: string, x: number, y: number): void {
    const isMd = detectFormat(filePath) === 'markdown';
    this.contextMenu.show(x, y, [
      {
        label: 'Open',
        onClick: () => void this.openFileByPath(filePath)
      },
      ...(isMd
        ? [
            {
              label: 'More Tools',
              submenu: [
                {
                  label: 'Localise all images',
                  onClick: () => void this.localiseAllImagesInFilePath(filePath)
                }
              ]
            }
          ]
        : []),
      { separator: true },
      {
        label: 'Reveal in Explorer',
        onClick: () => void bridge.revealInExplorer(filePath)
      },
      {
        label: 'Copy path',
        onClick: () => {
          void navigator.clipboard.writeText(filePath);
          this.showToast('Path copied');
        }
      }
    ]);
  }

  private async localiseSingleImage(tab: OpenTab, imageUrl: string): Promise<void> {
    if (!bridge.nativeHost) {
      this.showToast('Image localisation requires the desktop Skimd app');
      return;
    }
    this.showToast('Downloading image…');
    try {
      const res = await bridge.downloadImage({
        url: imageUrl,
        docDir: tab.dir ?? '',
        saveMode: this.settings.imageSaveMode,
        globalFolder: this.settings.imageGlobalFolder
      });
      tab.content = replaceImageUrlInMarkdown(tab.content, imageUrl, res.markdownRef);
      tab.dirty = tab.content !== tab.savedContent;
      tab.isWelcome = false;
      if (tab.id === this.activeTabId) {
        this.editor.setValue(tab.content);
        this.renderDocument();
        this.updateChrome();
      }
      this.showToast(`Localised → ${res.markdownRef}`);
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : 'Failed to localise image');
    }
  }

  private async localiseAllImagesInTab(tab: OpenTab): Promise<void> {
    if (!bridge.nativeHost) {
      this.showToast('Image localisation requires the desktop Skimd app');
      return;
    }
    const urls = findOnlineImageUrls(tab.content);
    if (urls.length === 0) {
      this.showToast('No online link images found in this file');
      return;
    }
    this.showToast(`Localising ${urls.length} image(s)…`);

    let updated = tab.content;
    let successCount = 0;
    let failCount = 0;

    for (const url of urls) {
      try {
        const res = await bridge.downloadImage({
          url,
          docDir: tab.dir ?? '',
          saveMode: this.settings.imageSaveMode,
          globalFolder: this.settings.imageGlobalFolder
        });
        updated = replaceImageUrlInMarkdown(updated, url, res.markdownRef);
        successCount++;
      } catch {
        failCount++;
      }
    }

    if (successCount > 0) {
      tab.content = updated;
      tab.dirty = tab.content !== tab.savedContent;
      tab.isWelcome = false;
      if (tab.id === this.activeTabId) {
        this.editor.setValue(tab.content);
        this.renderDocument();
        this.updateChrome();
      }
    }

    if (failCount > 0) {
      this.showToast(`Localised ${successCount} image(s) (${failCount} failed)`);
    } else {
      this.showToast(`Localised ${successCount} image(s)`);
    }
  }

  private async localiseAllImagesInFilePath(filePath: string): Promise<void> {
    const existingTab = this.tabs.find(
      (t) => t.path && t.path.toLowerCase() === filePath.toLowerCase()
    );
    if (existingTab) {
      await this.localiseAllImagesInTab(existingTab);
      return;
    }

    if (!bridge.nativeHost) return;
    try {
      const file = await bridge.readFile(filePath);
      const urls = findOnlineImageUrls(file.content);
      if (urls.length === 0) {
        this.showToast(`No online link images in ${file.name}`);
        return;
      }
      this.showToast(`Localising ${urls.length} image(s) in ${file.name}…`);

      let updated = file.content;
      let successCount = 0;
      let failCount = 0;

      for (const url of urls) {
        try {
          const res = await bridge.downloadImage({
            url,
            docDir: file.dir,
            saveMode: this.settings.imageSaveMode,
            globalFolder: this.settings.imageGlobalFolder
          });
          updated = replaceImageUrlInMarkdown(updated, url, res.markdownRef);
          successCount++;
        } catch {
          failCount++;
        }
      }

      if (successCount > 0) {
        await bridge.writeFile(file.path, updated);
      }

      if (failCount > 0) {
        this.showToast(`Localised ${successCount} image(s) in ${file.name} (${failCount} failed)`);
      } else {
        this.showToast(`Localised ${successCount} image(s) in ${file.name}`);
      }
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : 'Failed to process file');
    }
  }
}

const app = new SkimdApp();
void app.init();
