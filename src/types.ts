export type FileFormat = 'markdown' | 'json' | 'yaml' | 'csv' | 'toml' | 'text';

export type ViewMode = 'read' | 'split' | 'edit';

export type ThemeId = 'graphite' | 'black' | 'light' | 'system' | 'custom';

export type FontPairing = 'modern' | 'futuristic' | 'editorial';

export type SidebarTab = 'outline' | 'recent' | 'folder';

export type SplitOrder = 'editor-left' | 'preview-left';

export type ImageSaveMode = 'relative' | 'global';

export interface CustomThemeColors {
  bgBase: string;
  bgSurface: string;
  bgElevated: string;
  textPrimary: string;
  accent: string;
}

export interface AppSettings {
  theme: ThemeId;
  customTheme: CustomThemeColors;
  codeHighlightColor: string;
  tipColor: string;
  fontPairing: FontPairing;
  fontSize: number;
  lineHeight: number;
  maxWidth: string;
  defaultMode: ViewMode;
  splitOrder: SplitOrder;
  previewEditable: boolean;
  autoReload: boolean;
  wordWrap: boolean;
  showHiddenFiles: boolean;
  showStatusBar: boolean;
  imageSaveMode: ImageSaveMode;
  imageGlobalFolder: string;
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
}

export interface RecentEntry {
  path: string;
  name: string;
  dir: string;
  format: FileFormat;
  lastOpened: number;
  pinned?: boolean;
}

export interface OpenTab {
  id: string;
  path: string | null;
  name: string;
  dir: string | null;
  format: FileFormat;
  content: string;
  savedContent: string;
  dirty: boolean;
  mtimeMs: number;
  size: number;
  isWelcome?: boolean;
  externalUpdateAvailable?: boolean;
  structuredView?: 'tree' | 'code';
}

export interface OutlineItem {
  id: string;
  text: string;
  level: number;
}

export interface FrontmatterEntry {
  key: string;
  value: string;
}

export interface DocStats {
  words: number;
  lines: number;
  chars: number;
  readMinutes: number;
}

export interface WindowsStatus {
  exePath: string;
  exeDir: string;
  inUserPath: boolean;
  mdRegisteredToSkimd: boolean;
  mdUserChoiceProgId: string;
  mdLockedByOtherApp: boolean;
  structuredRegistered: boolean;
}

export interface FileReadResult {
  path: string;
  name: string;
  dir: string;
  content: string;
  mtimeMs: number;
  size: number;
}

export interface DirEntry {
  path: string;
  name: string;
  format: FileFormat;
  size: number;
  mtimeMs: number;
}

export interface HostConfigPayload {
  settings?: Partial<AppSettings>;
  recent?: RecentEntry[];
}

export interface HostReadyPayload {
  config: HostConfigPayload;
  windowsStatus: WindowsStatus;
  startupFiles: string[];
  appVersion: string;
}

export const DEFAULT_CUSTOM_THEME: CustomThemeColors = {
  bgBase: '#121212',
  bgSurface: '#1c1c1c',
  bgElevated: '#282828',
  textPrimary: '#f5f5f5',
  accent: '#ffffff'
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'graphite',
  customTheme: { ...DEFAULT_CUSTOM_THEME },
  codeHighlightColor: '',
  tipColor: '',
  fontPairing: 'modern',
  fontSize: 16,
  lineHeight: 1.68,
  maxWidth: '780px',
  defaultMode: 'read',
  splitOrder: 'editor-left',
  previewEditable: true,
  autoReload: true,
  wordWrap: true,
  showHiddenFiles: false,
  showStatusBar: true,
  imageSaveMode: 'relative',
  imageGlobalFolder: '',
  sidebarOpen: false,
  sidebarTab: 'outline'
};
