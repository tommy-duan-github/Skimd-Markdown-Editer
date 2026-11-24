import type {
  DirEntry,
  FileReadResult,
  HostConfigPayload,
  HostReadyPayload,
  ImageSaveMode,
  WindowsStatus
} from '../types.ts';
import type { DownloadImageResult } from './imageLocalise.ts';

declare global {
  interface Window {
    chrome?: {
      webview?: {
        postMessage(message: unknown): void;
        postMessageWithAdditionalObjects?(message: unknown, additionalObjects: unknown[]): void;
        addEventListener(type: string, listener: (event: MessageEvent) => void): void;
        removeEventListener(type: string, listener: (event: MessageEvent) => void): void;
      };
    };
  }
}

export type HostEventName = 'openFile' | 'externalFileChanged' | 'windowsStatus';

type EventHandler = (payload: unknown) => void;

const STORAGE_KEY = 'skimd.portable.config.v1';

interface PendingReq {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: number;
}

class SkimdBridge {
  private readonly isNative: boolean;
  private reqCounter = 0;
  private pending = new Map<string, PendingReq>();
  private listeners = new Map<HostEventName, Set<EventHandler>>();

  constructor() {
    this.isNative = Boolean(window.chrome && window.chrome.webview);
    if (this.isNative && window.chrome?.webview) {
      window.chrome.webview.addEventListener('message', (event) => {
        this.handleNativeMessage(event.data);
      });
    }
  }

  get nativeHost(): boolean {
    return this.isNative;
  }

  on(event: HostEventName, handler: EventHandler): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  private emit(event: HostEventName, payload: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      fn(payload);
    }
  }

  private handleNativeMessage(raw: unknown): void {
    let msg: Record<string, unknown>;
    if (typeof raw === 'string') {
      try {
        msg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }
    } else if (raw && typeof raw === 'object') {
      msg = raw as Record<string, unknown>;
    } else {
      return;
    }

    const reqId = typeof msg.reqId === 'string' ? msg.reqId : null;
    if (reqId && this.pending.has(reqId)) {
      const entry = this.pending.get(reqId)!;
      this.pending.delete(reqId);
      window.clearTimeout(entry.timer);
      if (msg.ok === false) {
        entry.reject(new Error(String(msg.error ?? 'Host request failed')));
      } else {
        entry.resolve(msg.data);
      }
      return;
    }

    const event = typeof msg.event === 'string' ? (msg.event as HostEventName) : null;
    if (event) {
      this.emit(event, msg.data);
    }
  }

  private request<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!this.isNative || !window.chrome?.webview) {
      return Promise.reject(new Error('Native WebView2 host unavailable'));
    }
    const reqId = `r_${++this.reqCounter}`;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (this.pending.has(reqId)) {
          this.pending.delete(reqId);
          reject(new Error(`Host request timed out: ${action}`));
        }
      }, 30000);
      this.pending.set(reqId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer
      });
      window.chrome!.webview!.postMessage({ reqId, action, payload });
    });
  }

  async ready(): Promise<HostReadyPayload> {
    if (this.isNative) {
      return this.request<HostReadyPayload>('ready');
    }
    let config: HostConfigPayload = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) config = JSON.parse(raw) as HostConfigPayload;
    } catch {
      config = {};
    }
    return {
      config,
      windowsStatus: {
        exePath: 'Browser Preview Mode',
        exeDir: '',
        inUserPath: false,
        mdRegisteredToSkimd: false,
        mdUserChoiceProgId: '',
        mdLockedByOtherApp: false,
        structuredRegistered: false
      },
      startupFiles: [],
      appVersion: '0.1.0-web'
    };
  }

  async readFile(path: string): Promise<FileReadResult> {
    return this.request<FileReadResult>('readFile', { path });
  }

  async writeFile(path: string, content: string): Promise<{ mtimeMs: number; size: number }> {
    if (this.isNative) {
      return this.request<{ mtimeMs: number; size: number }>('writeFile', { path, content });
    }
    return { mtimeMs: Date.now(), size: content.length };
  }

  async openFileDialog(): Promise<FileReadResult | null> {
    if (this.isNative) {
      return this.request<FileReadResult | null>('openFileDialog');
    }
    return new Promise<FileReadResult | null>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.md,.markdown,.mdx,.yaml,.yml,.json,.jsonc,.csv,.tsv,.toml,.ini,.txt,.log';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        const content = await file.text();
        resolve({
          path: file.name,
          name: file.name,
          dir: '',
          content,
          mtimeMs: file.lastModified,
          size: file.size
        });
      };
      input.click();
    });
  }

  async saveFileDialog(suggestedName: string, content: string): Promise<FileReadResult | null> {
    if (this.isNative) {
      return this.request<FileReadResult | null>('saveFileDialog', { suggestedName, content });
    }
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName || 'document.md';
    a.click();
    URL.revokeObjectURL(url);
    return {
      path: a.download,
      name: a.download,
      dir: '',
      content,
      mtimeMs: Date.now(),
      size: content.length
    };
  }

  async listDir(dir: string, showHidden = false): Promise<DirEntry[]> {
    if (!this.isNative || !dir) return [];
    return this.request<DirEntry[]>('listDir', { dir, showHidden });
  }

  async pickFolderDialog(): Promise<string | null> {
    if (!this.isNative) return null;
    return this.request<string | null>('pickFolderDialog');
  }

  async downloadImage(opts: {
    url: string;
    docDir: string;
    saveMode: ImageSaveMode;
    globalFolder: string;
  }): Promise<DownloadImageResult> {
    return this.request<DownloadImageResult>('downloadImage', opts);
  }

  async saveConfig(config: HostConfigPayload): Promise<void> {
    if (this.isNative) {
      await this.request('saveConfig', { config });
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // Ignore storage quota errors
    }
  }

  async setTheme(resolvedTheme: 'dark' | 'light', bgHex?: string): Promise<void> {
    if (!this.isNative) return;
    await this.request('setTheme', { theme: resolvedTheme, bgHex: bgHex ?? '' });
  }

  async setWindowTitle(title: string): Promise<void> {
    if (!this.isNative) return;
    await this.request('setWindowTitle', { title });
  }

  async openExternal(url: string): Promise<void> {
    if (this.isNative) {
      await this.request('openExternal', { url });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async revealInExplorer(path: string): Promise<void> {
    if (!this.isNative || !path) return;
    await this.request('revealInExplorer', { path });
  }

  async getWindowsStatus(): Promise<WindowsStatus> {
    return this.request<WindowsStatus>('getWindowsStatus');
  }

  async registerWindows(options: {
    path: boolean;
    md: boolean;
    structured: boolean;
  }): Promise<WindowsStatus> {
    return this.request<WindowsStatus>('registerWindows', options);
  }

  async unregisterWindows(): Promise<WindowsStatus> {
    return this.request<WindowsStatus>('unregisterWindows');
  }

  async openDefaultApps(): Promise<void> {
    if (!this.isNative) return;
    await this.request('openDefaultApps');
  }

  async printDocument(): Promise<void> {
    if (this.isNative) {
      await this.request('print');
      return;
    }
    window.print();
  }

  forwardDroppedFiles(files: FileList): boolean {
    if (
      this.isNative &&
      window.chrome?.webview &&
      typeof window.chrome.webview.postMessageWithAdditionalObjects === 'function'
    ) {
      window.chrome.webview.postMessageWithAdditionalObjects(
        { action: 'dropFiles' },
        Array.from(files)
      );
      return true;
    }
    return false;
  }
}

export const bridge = new SkimdBridge();
