import { escapeHtml } from '../lib/formats.ts';
import type { DirEntry, OutlineItem, RecentEntry, SidebarTab } from '../types.ts';
import { ICON_NEW, ICON_OPEN, ICON_SETTINGS } from './icons.ts';

export interface SidebarCallbacks {
  onSelectTab: (tab: SidebarTab) => void;
  onJumpOutline: (id: string) => void;
  onOpenPath: (path: string) => void;
  onClearRecent: () => void;
  onRemoveRecent: (path: string) => void;
  onRefreshFolder: () => void;
  onOpenFile: () => void;
  onNewFile: () => void;
  onOpenSettings: () => void;
  onContextMenuFile: (path: string, x: number, y: number) => void;
}

export class SidebarView {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabButtons: Map<SidebarTab, HTMLButtonElement> = new Map();
  private readonly callbacks: SidebarCallbacks;

  constructor(root: HTMLElement, callbacks: SidebarCallbacks) {
    this.root = root;
    this.callbacks = callbacks;

    this.root.innerHTML = `
      <div class="sidebar-actions">
        <button type="button" class="sidebar-action-btn" id="sb-open-btn" title="Open file (Ctrl+O)">${ICON_OPEN}<span>Open</span></button>
        <button type="button" class="sidebar-action-btn" id="sb-new-btn" title="New document (Ctrl+N)">${ICON_NEW}<span>New</span></button>
      </div>
      <div class="sidebar-tabs" role="tablist">
        <button type="button" class="sidebar-tab" data-tab="outline">Outline</button>
        <button type="button" class="sidebar-tab" data-tab="recent">Recent</button>
        <button type="button" class="sidebar-tab" data-tab="folder">Folder</button>
      </div>
      <div class="sidebar-body"></div>
      <div class="sidebar-footer">
        <button type="button" class="sidebar-footer-btn" id="sb-settings-btn" title="Settings (Ctrl+,)">${ICON_SETTINGS}<span>Settings</span></button>
      </div>
    `;

    this.body = this.root.querySelector('.sidebar-body') as HTMLElement;
    const btns = this.root.querySelectorAll<HTMLButtonElement>('.sidebar-tab');
    btns.forEach((btn) => {
      const tab = btn.dataset.tab as SidebarTab;
      this.tabButtons.set(tab, btn);
      btn.addEventListener('click', () => this.callbacks.onSelectTab(tab));
    });

    this.root.querySelector('#sb-open-btn')?.addEventListener('click', () => {
      this.callbacks.onOpenFile();
    });
    this.root.querySelector('#sb-new-btn')?.addEventListener('click', () => {
      this.callbacks.onNewFile();
    });
    this.root.querySelector('#sb-settings-btn')?.addEventListener('click', () => {
      this.callbacks.onOpenSettings();
    });
  }

  setCollapsed(collapsed: boolean): void {
    this.root.classList.toggle('collapsed', collapsed);
  }

  render(state: {
    activeTab: SidebarTab;
    outline: OutlineItem[];
    recent: RecentEntry[];
    activePath: string | null;
    activeDir: string | null;
    folderEntries: DirEntry[];
    folderLoading: boolean;
  }): void {
    this.tabButtons.forEach((btn, tab) => {
      btn.classList.toggle('active', tab === state.activeTab);
    });

    if (state.activeTab === 'outline') {
      this.renderOutline(state.outline);
      return;
    }

    if (state.activeTab === 'recent') {
      this.renderRecent(state.recent, state.activePath);
      return;
    }

    this.renderFolder(state.activeDir, state.folderEntries, state.activePath, state.folderLoading);
  }

  private renderOutline(outline: OutlineItem[]): void {
    if (outline.length === 0) {
      this.body.innerHTML = `<div class="sidebar-empty">No headings or top-level keys detected in this document.</div>`;
      return;
    }
    const itemsHtml = outline
      .map(
        (item) =>
          `<button type="button" class="outline-item level-${Math.min(
            4,
            Math.max(1, item.level)
          )}" data-jump-id="${escapeHtml(item.id)}" title="${escapeHtml(item.text)}">${escapeHtml(
            item.text
          )}</button>`
      )
      .join('');

    this.body.innerHTML = `<div class="sidebar-section-head"><span>Document Outline</span><span>${outline.length}</span></div><div class="sidebar-list">${itemsHtml}</div>`;
    this.body.querySelectorAll<HTMLButtonElement>('[data-jump-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.jumpId;
        if (id) this.callbacks.onJumpOutline(id);
      });
    });
  }

  private renderRecent(recent: RecentEntry[], activePath: string | null): void {
    if (recent.length === 0) {
      this.body.innerHTML = `<div class="sidebar-empty">No recent files yet.<br/>Open a file above or drag one onto Skimd.</div>`;
      return;
    }
    const listHtml = recent
      .map((entry) => {
        const isActive = activePath && entry.path.toLowerCase() === activePath.toLowerCase();
        return `<div class="sidebar-item${isActive ? ' active' : ''}" data-open-path="${escapeHtml(
          entry.path
        )}" title="${escapeHtml(entry.path)}">
          <div class="sidebar-item-main">
            <span class="sidebar-item-title">${escapeHtml(entry.name)}</span>
            <span class="sidebar-item-sub">${escapeHtml(entry.dir || 'Local')}</span>
          </div>
          <button type="button" class="tab-close" data-remove-recent="${escapeHtml(
            entry.path
          )}" title="Remove from recent">×</button>
        </div>`;
      })
      .join('');

    this.body.innerHTML = `<div class="sidebar-section-head"><span>Recent Files</span><button type="button" class="mini-btn" id="clear-recent-btn">Clear</button></div><div class="sidebar-list">${listHtml}</div>`;

    this.body.querySelector('#clear-recent-btn')?.addEventListener('click', () => {
      this.callbacks.onClearRecent();
    });

    this.body.querySelectorAll<HTMLElement>('[data-open-path]').forEach((el) => {
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('[data-remove-recent]')) return;
        const p = el.dataset.openPath;
        if (p) this.callbacks.onOpenPath(p);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const p = el.dataset.openPath;
        if (p) this.callbacks.onContextMenuFile(p, e.clientX, e.clientY);
      });
    });

    this.body.querySelectorAll<HTMLElement>('[data-remove-recent]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = btn.dataset.removeRecent;
        if (p) this.callbacks.onRemoveRecent(p);
      });
    });
  }

  private renderFolder(
    activeDir: string | null,
    entries: DirEntry[],
    activePath: string | null,
    loading: boolean
  ): void {
    if (!activeDir) {
      this.body.innerHTML = `<div class="sidebar-empty">Open a local file to browse supported files in its folder.</div>`;
      return;
    }
    if (loading) {
      this.body.innerHTML = `<div class="sidebar-empty">Reading folder…</div>`;
      return;
    }
    const header = `<div class="sidebar-section-head"><span title="${escapeHtml(
      activeDir
    )}">Folder (${entries.length})</span><button type="button" class="mini-btn" id="refresh-folder-btn">Refresh</button></div>`;

    if (entries.length === 0) {
      this.body.innerHTML = `${header}<div class="sidebar-empty">No supported documents in this folder.</div>`;
    } else {
      const listHtml = entries
        .map((entry) => {
          const isActive = activePath && entry.path.toLowerCase() === activePath.toLowerCase();
          return `<button type="button" class="sidebar-item${
            isActive ? ' active' : ''
          }" data-folder-path="${escapeHtml(entry.path)}" title="${escapeHtml(entry.path)}">
            <span class="sidebar-item-title">${escapeHtml(entry.name)}</span>
          </button>`;
        })
        .join('');
      this.body.innerHTML = `${header}<div class="sidebar-list">${listHtml}</div>`;
    }

    this.body.querySelector('#refresh-folder-btn')?.addEventListener('click', () => {
      this.callbacks.onRefreshFolder();
    });

    this.body.querySelectorAll<HTMLButtonElement>('[data-folder-path]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.folderPath;
        if (p) this.callbacks.onOpenPath(p);
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const p = btn.dataset.folderPath;
        if (p) this.callbacks.onContextMenuFile(p, e.clientX, e.clientY);
      });
    });
  }
}
