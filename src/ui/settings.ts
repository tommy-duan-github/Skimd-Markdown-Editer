import { escapeHtml } from '../lib/formats.ts';
import {
  BUILTIN_THEME_COLORS,
  HIGHLIGHT_SWATCHES,
  THEME_PRESETS,
  normalizeThemeId
} from '../lib/theme.ts';
import {
  DEFAULT_CUSTOM_THEME,
  type AppSettings,
  type CustomThemeColors,
  type FontPairing,
  type ImageSaveMode,
  type SplitOrder,
  type ThemeId,
  type ViewMode,
  type WindowsStatus
} from '../types.ts';
import {
  ICON_CLOSE,
  ICON_PALETTE,
  ICON_SLIDERS,
  ICON_TYPE,
  ICON_WINDOWS,
  SKIMD_LOGO_SVG
} from './icons.ts';
import { SkimdDropdown } from './dropdown.ts';

type SettingsSection = 'general' | 'reading' | 'personalisation' | 'windows';

export interface SettingsCallbacks {
  onUpdate: (patch: Partial<AppSettings>) => void;
  onRegisterWindows: (opts: { path: boolean; md: boolean; structured: boolean }) => Promise<void>;
  onUnregisterWindows: () => Promise<void>;
  onOpenDefaultApps: () => Promise<void>;
  onPickImageFolder: () => Promise<string | null>;
}

export class SettingsModal {
  private readonly backdrop: HTMLElement;
  private readonly navEl: HTMLElement;
  private readonly contentEl: HTMLElement;
  private readonly callbacks: SettingsCallbacks;
  private isOpen = false;
  private activeSection: SettingsSection = 'general';
  private busyWindows = false;

  private lastSettings!: AppSettings;
  private lastWinStatus!: WindowsStatus;
  private lastIsNative = false;
  private sectionDropdowns: SkimdDropdown[] = [];

  constructor(root: HTMLElement, callbacks: SettingsCallbacks) {
    this.backdrop = root;
    this.callbacks = callbacks;

    this.backdrop.className = 'modal-backdrop hidden';
    this.backdrop.innerHTML = `
      <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <div class="modal-header">
          <span class="modal-title">Settings</span>
          <button type="button" class="icon-btn" id="settings-close-btn" title="Close (Esc)">${ICON_CLOSE}</button>
        </div>
        <div class="settings-layout">
          <nav class="settings-nav" aria-label="Settings sections">
            <button type="button" class="settings-nav-btn" data-section="general">${ICON_SLIDERS}<span>General</span></button>
            <button type="button" class="settings-nav-btn" data-section="reading">${ICON_TYPE}<span>Reading</span></button>
            <button type="button" class="settings-nav-btn" data-section="personalisation">${ICON_PALETTE}<span>Personalisation</span></button>
            <button type="button" class="settings-nav-btn" data-section="windows">${ICON_WINDOWS}<span>Windows &amp; Info</span></button>
          </nav>
          <div class="settings-content"></div>
        </div>
      </div>
    `;

    this.navEl = this.backdrop.querySelector('.settings-nav') as HTMLElement;
    this.contentEl = this.backdrop.querySelector('.settings-content') as HTMLElement;

    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });

    this.backdrop.querySelector('#settings-close-btn')?.addEventListener('click', () => {
      this.close();
    });

    this.navEl.querySelectorAll<HTMLButtonElement>('.settings-nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeSection = btn.dataset.section as SettingsSection;
        this.render(this.lastSettings, this.lastWinStatus, this.lastIsNative);
      });
    });
  }

  get opened(): boolean {
    return this.isOpen;
  }

  open(settings: AppSettings, winStatus: WindowsStatus, isNativeHost: boolean): void {
    this.isOpen = true;
    this.backdrop.classList.remove('hidden');
    this.render(settings, winStatus, isNativeHost);
  }

  close(): void {
    this.isOpen = false;
    this.clearDropdowns();
    this.backdrop.classList.add('hidden');
  }

  private clearDropdowns(): void {
    for (const dd of this.sectionDropdowns) {
      dd.destroy();
    }
    this.sectionDropdowns = [];
  }

  render(settings: AppSettings, winStatus: WindowsStatus, isNativeHost: boolean): void {
    this.lastSettings = settings;
    this.lastWinStatus = winStatus;
    this.lastIsNative = isNativeHost;
    if (!this.isOpen) return;

    this.clearDropdowns();

    this.navEl.querySelectorAll<HTMLButtonElement>('.settings-nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.section === this.activeSection);
    });

    if (this.activeSection === 'general') {
      this.renderGeneral(settings);
    } else if (this.activeSection === 'reading') {
      this.renderReading(settings);
    } else if (this.activeSection === 'personalisation') {
      this.renderPersonalisation(settings);
    } else {
      this.renderWindowsAndAbout(winStatus, isNativeHost);
    }
  }

  private applyPatch(patch: Partial<AppSettings>): void {
    this.lastSettings = { ...this.lastSettings, ...patch };
    this.callbacks.onUpdate(patch);
  }

  private renderToggle(id: string, checked: boolean): string {
    return `<label class="toggle-switch"><input id="${id}" type="checkbox"${
      checked ? ' checked' : ''
    } /><span class="toggle-track"></span></label>`;
  }

  private renderGeneral(settings: AppSettings): void {
    this.contentEl.innerHTML = `
      <div class="settings-section-header">General</div>
      <div class="settings-card">
        <div class="settings-card-title">Startup &amp; Modes</div>
        <div class="setting-row">
          <div class="setting-label-stack">
            <span class="setting-label-main">Default open mode</span>
            <span class="setting-label-sub">Initial layout when launching Skimd</span>
          </div>
          <div class="skimd-select-slot" id="s-mode-slot"></div>
        </div>
        <div class="setting-row">
          <div class="setting-label-stack">
            <span class="setting-label-main">Split mode arrangement</span>
            <span class="setting-label-sub">Choose which side shows Preview vs Edit</span>
          </div>
          <div class="skimd-select-slot" id="s-split-order-slot"></div>
        </div>
        <div class="setting-row">
          <div class="setting-label-stack">
            <span class="setting-label-main">Edit Markdown directly in Preview</span>
            <span class="setting-label-sub">Click anywhere in rendered Markdown to type and format</span>
          </div>
          ${this.renderToggle('s-preview-edit', settings.previewEditable)}
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">Files &amp; Workspace</div>
        <div class="setting-row">
          <div class="setting-label-stack">
            <span class="setting-label-main">Auto-reload external changes</span>
            <span class="setting-label-sub">Refresh clean tabs when modified on disk</span>
          </div>
          ${this.renderToggle('s-autoreload', settings.autoReload)}
        </div>
        <div class="setting-row">
          <div class="setting-label-stack">
            <span class="setting-label-main">Editor word wrap</span>
            <span class="setting-label-sub">Wrap long lines in Source &amp; Split mode</span>
          </div>
          ${this.renderToggle('s-wrap', settings.wordWrap)}
        </div>
        <div class="setting-row">
          <div class="setting-label-stack">
            <span class="setting-label-main">Show hidden files</span>
            <span class="setting-label-sub">Display dot-prefixed and Windows hidden files in Folder</span>
          </div>
          ${this.renderToggle('s-hidden-files', settings.showHiddenFiles)}
        </div>
        <div class="setting-row">
          <div class="setting-label-stack">
            <span class="setting-label-main">Show bottom status bar</span>
            <span class="setting-label-sub">Display file path, word count, and reading time</span>
          </div>
          ${this.renderToggle('s-status', settings.showStatusBar)}
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">Images</div>
        <div class="setting-row">
          <div class="setting-label-stack">
            <span class="setting-label-main">Localise destination</span>
            <span class="setting-label-sub">Where downloaded online images are saved</span>
          </div>
          <div class="skimd-select-slot" id="s-img-mode-slot"></div>
        </div>
        <div class="img-folder-row${settings.imageSaveMode === 'global' ? '' : ' hidden'}" id="s-img-global-row">
          <span class="img-folder-path" id="s-img-global-path" title="${escapeHtml(
            settings.imageGlobalFolder || 'No folder selected'
          )}">${escapeHtml(settings.imageGlobalFolder || 'No folder selected')}</span>
          <button type="button" class="mini-btn" id="s-img-browse-btn">Browse…</button>
        </div>
      </div>
    `;

    this.sectionDropdowns.push(
      new SkimdDropdown(this.contentEl.querySelector('#s-mode-slot')!, {
        variant: 'field',
        ariaLabel: 'Default open mode',
        value: settings.defaultMode,
        options: [
          { value: 'read', label: 'Read (Preview)' },
          { value: 'split', label: 'Split' },
          { value: 'edit', label: 'Edit (Source)' }
        ],
        onChange: (val) => this.applyPatch({ defaultMode: val as ViewMode })
      }),
      new SkimdDropdown(this.contentEl.querySelector('#s-split-order-slot')!, {
        variant: 'field',
        ariaLabel: 'Split mode arrangement',
        value: settings.splitOrder,
        options: [
          { value: 'editor-left', label: 'Edit left · Preview right' },
          { value: 'preview-left', label: 'Preview left · Edit right' }
        ],
        onChange: (val) => this.applyPatch({ splitOrder: val as SplitOrder })
      }),
      new SkimdDropdown(this.contentEl.querySelector('#s-img-mode-slot')!, {
        variant: 'field',
        ariaLabel: 'Localise destination',
        value: settings.imageSaveMode,
        options: [
          { value: 'relative', label: 'Relative (/image folder)' },
          { value: 'global', label: 'Global local folder' }
        ],
        onChange: (val) => {
          const mode = val as ImageSaveMode;
          this.applyPatch({ imageSaveMode: mode });
          this.contentEl
            .querySelector('#s-img-global-row')
            ?.classList.toggle('hidden', mode !== 'global');
        }
      })
    );

    this.contentEl.querySelector('#s-img-browse-btn')?.addEventListener('click', async () => {
      const picked = await this.callbacks.onPickImageFolder();
      if (picked) {
        this.applyPatch({ imageSaveMode: 'global', imageGlobalFolder: picked });
        const pathEl = this.contentEl.querySelector('#s-img-global-path');
        if (pathEl) {
          pathEl.textContent = picked;
          (pathEl as HTMLElement).title = picked;
        }
      }
    });

    this.contentEl.querySelector('#s-preview-edit')?.addEventListener('change', (e) => {
      this.applyPatch({
        previewEditable: (e.target as HTMLInputElement).checked
      });
    });

    this.contentEl.querySelector('#s-autoreload')?.addEventListener('change', (e) => {
      this.applyPatch({ autoReload: (e.target as HTMLInputElement).checked });
    });

    this.contentEl.querySelector('#s-wrap')?.addEventListener('change', (e) => {
      this.applyPatch({ wordWrap: (e.target as HTMLInputElement).checked });
    });

    this.contentEl.querySelector('#s-hidden-files')?.addEventListener('change', (e) => {
      this.applyPatch({ showHiddenFiles: (e.target as HTMLInputElement).checked });
    });

    this.contentEl.querySelector('#s-status')?.addEventListener('change', (e) => {
      this.applyPatch({ showStatusBar: (e.target as HTMLInputElement).checked });
    });
  }

  private renderReading(settings: AppSettings): void {
    this.contentEl.innerHTML = `
      <div class="settings-section-header">Reading &amp; Typography</div>
      <div class="settings-card">
        <div class="settings-card-title">Fonts</div>
        <div class="setting-row">
          <div class="setting-label-stack">
            <span class="setting-label-main">Font pairing</span>
            <span class="setting-label-sub">Body &amp; heading family used for prose</span>
          </div>
          <div class="skimd-select-slot" id="s-font-slot"></div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">Layout Comfort</div>
        <div class="setting-row">
          <div class="setting-label-stack">
            <span class="setting-label-main">Font size</span>
            <span class="setting-label-sub" id="s-fontsize-val">${settings.fontSize}px</span>
          </div>
          <input id="s-fontsize" class="setting-range" type="range" min="13" max="22" step="1" value="${settings.fontSize}" />
        </div>
        <div class="setting-row">
          <div class="setting-label-stack">
            <span class="setting-label-main">Line height</span>
            <span class="setting-label-sub" id="s-lineheight-val">${settings.lineHeight.toFixed(2)}</span>
          </div>
          <input id="s-lineheight" class="setting-range" type="range" min="1.35" max="2.0" step="0.05" value="${settings.lineHeight}" />
        </div>
        <div class="setting-row">
          <div class="setting-label-stack">
            <span class="setting-label-main">Reading width</span>
            <span class="setting-label-sub">Maximum column width for prose</span>
          </div>
          <div class="skimd-select-slot" id="s-width-slot"></div>
        </div>
      </div>
    `;

    this.sectionDropdowns.push(
      new SkimdDropdown(this.contentEl.querySelector('#s-font-slot')!, {
        variant: 'field',
        ariaLabel: 'Font pairing',
        value: settings.fontPairing,
        options: [
          { value: 'modern', label: 'Modern (Inter)' },
          { value: 'futuristic', label: 'Geometric (Space Grotesk)' },
          { value: 'editorial', label: 'Editorial (Serif)' }
        ],
        onChange: (val) => this.applyPatch({ fontPairing: val as FontPairing })
      }),
      new SkimdDropdown(this.contentEl.querySelector('#s-width-slot')!, {
        variant: 'field',
        ariaLabel: 'Reading width',
        value: settings.maxWidth,
        options: [
          { value: '680px', label: 'Compact (680px)' },
          { value: '780px', label: 'Balanced (780px)' },
          { value: '960px', label: 'Wide (960px)' },
          { value: '100%', label: 'Full Width' }
        ],
        onChange: (val) => this.applyPatch({ maxWidth: val })
      })
    );

    this.contentEl.querySelector('#s-fontsize')?.addEventListener('input', (e) => {
      const val = Number((e.target as HTMLInputElement).value);
      this.applyPatch({ fontSize: val });
      const sub = this.contentEl.querySelector('#s-fontsize-val');
      if (sub) sub.textContent = `${val}px`;
    });

    this.contentEl.querySelector('#s-lineheight')?.addEventListener('input', (e) => {
      const val = Number((e.target as HTMLInputElement).value);
      this.applyPatch({ lineHeight: val });
      const sub = this.contentEl.querySelector('#s-lineheight-val');
      if (sub) sub.textContent = val.toFixed(2);
    });
  }

  private renderSwatchButtons(targetKey: 'codeHighlightColor' | 'tipColor', currentVal: string): string {
    return HIGHLIGHT_SWATCHES.map((sw) => {
      const active = (currentVal || '').toLowerCase() === sw.value.toLowerCase();
      const dotStyle = sw.value
        ? `background:${sw.value}`
        : `background:linear-gradient(135deg,#ffffff 50%,#333333 50%)`;
      return `<button type="button" class="swatch-circle${
        active ? ' active' : ''
      }" data-hl-key="${targetKey}" data-hl-val="${sw.value}" title="${sw.label}" style="${dotStyle}"></button>`;
    }).join('');
  }

  private renderPersonalisation(settings: AppSettings): void {
    const activeTheme = normalizeThemeId(settings.theme);
    const custom = settings.customTheme ?? DEFAULT_CUSTOM_THEME;
    const codeHl = settings.codeHighlightColor || '';
    const tipHl = settings.tipColor || '';

    const themeCards: Array<{ id: ThemeId; label: string; swatches: [string, string, string] }> = [
      { id: 'graphite', label: 'Graphite', swatches: ['#121212', '#272727', '#ffffff'] },
      { id: 'black', label: 'True Black', swatches: ['#000000', '#1c1c1c', '#ffffff'] },
      { id: 'light', label: 'Clean Light', swatches: ['#f3f3f3', '#ffffff', '#181818'] },
      { id: 'system', label: 'System', swatches: ['#121212', '#888888', '#f3f3f3'] },
      {
        id: 'custom',
        label: 'Custom',
        swatches: [custom.bgBase, custom.bgSurface, custom.accent]
      }
    ];

    const cardsHtml = themeCards
      .map(
        (card) => `<button type="button" class="theme-card${
          activeTheme === card.id ? ' active' : ''
        }" data-theme-id="${card.id}">
          <div class="theme-swatch-row">
            <span class="theme-swatch-dot" style="background:${card.swatches[0]}"></span>
            <span class="theme-swatch-dot" style="background:${card.swatches[1]}"></span>
            <span class="theme-swatch-dot" style="background:${card.swatches[2]}"></span>
          </div>
          <span class="theme-card-label">${card.label}</span>
        </button>`
      )
      .join('');

    const colorFields: Array<{ key: keyof CustomThemeColors; label: string }> = [
      { key: 'bgBase', label: 'Background' },
      { key: 'bgSurface', label: 'Surface' },
      { key: 'bgElevated', label: 'Elevated' },
      { key: 'textPrimary', label: 'Text' },
      { key: 'accent', label: 'Highlight' }
    ];

    const colorsHtml = colorFields
      .map(
        (field) => `<label class="color-tile">
          <span>${field.label}</span>
          <input type="color" class="color-tile-input" data-color-key="${field.key}" value="${escapeHtml(
          custom[field.key]
        )}" />
        </label>`
      )
      .join('');

    const presetsHtml = THEME_PRESETS.map(
      (p) => `<button type="button" class="mini-btn" data-preset-id="${p.id}">${p.name}</button>`
    ).join('');

    this.contentEl.innerHTML = `
      <div class="settings-section-header">Personalisation</div>
      <div class="settings-card">
        <div class="settings-card-title">Theme</div>
        <div class="theme-grid">${cardsHtml}</div>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">Highlights</div>
        <div class="highlight-row">
          <span class="setting-label-main">Code text</span>
          <div class="highlight-controls">
            <div class="swatch-dots">${this.renderSwatchButtons('codeHighlightColor', codeHl)}</div>
            <input type="color" class="color-tile-input" id="hl-code-picker" value="${escapeHtml(
              codeHl || '#d6d6d6'
            )}" title="Pick any code highlight color" />
          </div>
        </div>
        <div class="highlight-row">
          <span class="setting-label-main">Tip callout</span>
          <div class="highlight-controls">
            <div class="swatch-dots">${this.renderSwatchButtons('tipColor', tipHl)}</div>
            <input type="color" class="color-tile-input" id="hl-tip-picker" value="${escapeHtml(
              tipHl || '#ffffff'
            )}" title="Pick any tip callout color" />
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="setting-row">
          <div class="settings-card-title">Custom Theme Studio</div>
          <button type="button" class="mini-btn" id="custom-theme-reset">Reset</button>
        </div>
        <div class="color-grid">${colorsHtml}</div>
        <div class="settings-card-title">Starter Palettes</div>
        <div class="preset-chip-row">${presetsHtml}</div>
      </div>
    `;

    this.contentEl.querySelectorAll<HTMLButtonElement>('[data-theme-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const themeId = btn.dataset.themeId as ThemeId;
        if (themeId === 'graphite' || themeId === 'black' || themeId === 'light') {
          const baseColors = { ...BUILTIN_THEME_COLORS[themeId] };
          this.applyPatch({ theme: themeId, customTheme: baseColors });
          this.renderPersonalisation(this.lastSettings);
        } else {
          this.applyPatch({ theme: themeId });
          this.renderPersonalisation(this.lastSettings);
        }
      });
    });

    this.contentEl.querySelector('#hl-code-picker')?.addEventListener('input', (e) => {
      const val = (e.target as HTMLInputElement).value;
      this.applyPatch({ codeHighlightColor: val });
      this.refreshHighlightSwatchState('codeHighlightColor', val);
    });

    this.contentEl.querySelector('#hl-tip-picker')?.addEventListener('input', (e) => {
      const val = (e.target as HTMLInputElement).value;
      this.applyPatch({ tipColor: val });
      this.refreshHighlightSwatchState('tipColor', val);
    });

    this.contentEl.querySelectorAll<HTMLButtonElement>('[data-hl-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.hlKey as 'codeHighlightColor' | 'tipColor';
        const val = btn.dataset.hlVal ?? '';
        this.applyPatch({ [key]: val });
        this.renderPersonalisation(this.lastSettings);
      });
    });

    this.contentEl.querySelectorAll<HTMLInputElement>('[data-color-key]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.colorKey as keyof CustomThemeColors;
        const nextCustom: CustomThemeColors = {
          ...(this.lastSettings.customTheme ?? DEFAULT_CUSTOM_THEME),
          [key]: input.value
        };
        this.applyPatch({ theme: 'custom', customTheme: nextCustom });
        this.contentEl.querySelectorAll<HTMLButtonElement>('[data-theme-id]').forEach((btn) => {
          btn.classList.toggle('active', btn.dataset.themeId === 'custom');
        });
        const customCardDots = this.contentEl.querySelectorAll<HTMLElement>(
          '[data-theme-id="custom"] .theme-swatch-dot'
        );
        if (customCardDots.length === 3) {
          customCardDots[0].style.background = nextCustom.bgBase;
          customCardDots[1].style.background = nextCustom.bgSurface;
          customCardDots[2].style.background = nextCustom.accent;
        }
      });
    });

    this.contentEl.querySelectorAll<HTMLButtonElement>('[data-preset-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = THEME_PRESETS.find((p) => p.id === btn.dataset.presetId);
        if (!preset) return;
        const nextCustom = { ...preset.colors };
        this.applyPatch({ theme: 'custom', customTheme: nextCustom });
        this.renderPersonalisation(this.lastSettings);
      });
    });

    this.contentEl.querySelector('#custom-theme-reset')?.addEventListener('click', () => {
      const nextCustom = { ...DEFAULT_CUSTOM_THEME };
      this.applyPatch({
        theme: 'graphite',
        customTheme: nextCustom,
        codeHighlightColor: '',
        tipColor: ''
      });
      this.renderPersonalisation(this.lastSettings);
    });
  }

  private refreshHighlightSwatchState(
    key: 'codeHighlightColor' | 'tipColor',
    val: string
  ): void {
    this.contentEl
      .querySelectorAll<HTMLButtonElement>(`[data-hl-key="${key}"]`)
      .forEach((btn) => {
        btn.classList.toggle(
          'active',
          (btn.dataset.hlVal ?? '').toLowerCase() === val.toLowerCase()
        );
      });
  }

  private renderWindowsAndAbout(winStatus: WindowsStatus, isNativeHost: boolean): void {
    const pathBadge = winStatus.inUserPath
      ? `<span class="pill-badge ok">In User PATH</span>`
      : `<span class="pill-badge">Not in PATH</span>`;

    let mdBadge = `<span class="pill-badge">Not set</span>`;
    if (winStatus.mdRegisteredToSkimd && !winStatus.mdLockedByOtherApp) {
      mdBadge = `<span class="pill-badge ok">Default (.md)</span>`;
    } else if (winStatus.mdLockedByOtherApp) {
      mdBadge = `<span class="pill-badge warn">Owned by ${escapeHtml(
        winStatus.mdUserChoiceProgId || 'another app'
      )}</span>`;
    } else if (winStatus.mdRegisteredToSkimd) {
      mdBadge = `<span class="pill-badge ok">Registered</span>`;
    }

    const windowsCard = isNativeHost
      ? `<div class="settings-card">
          <div class="settings-card-title">Windows Integration (Opt-In)</div>
          <div class="win-status-card">
            <div class="win-status-line">
              <span>Command Line (<code>skimd</code>)</span>
              ${pathBadge}
            </div>
            <div class="win-status-line">
              <span>Markdown Association (<code>.md</code>)</span>
              ${mdBadge}
            </div>
            <div class="win-btn-row">
              <button type="button" class="mini-btn accent" id="win-reg-all" ${
                this.busyWindows ? 'disabled' : ''
              }>Register PATH + .md</button>
              <button type="button" class="mini-btn" id="win-reg-structured" ${
                this.busyWindows ? 'disabled' : ''
              }>+ YAML &amp; JSON</button>
              <button type="button" class="mini-btn" id="win-unreg" ${
                this.busyWindows ? 'disabled' : ''
              }>Unregister</button>
            </div>
            ${
              winStatus.mdLockedByOtherApp
                ? `<div class="win-note">Windows locks <code>.md</code> to your current default app. Click below and pick <strong>Skimd</strong> under <code>.md</code>:</div>
                   <div><button type="button" class="mini-btn" id="win-open-defaults">Open Windows Default Apps</button></div>`
                : `<div class="win-note">Portable folder: <code>${escapeHtml(
                    winStatus.exeDir
                  )}</code></div>`
            }
          </div>
        </div>`
      : `<div class="settings-card">
          <div class="settings-card-title">Windows Integration</div>
          <div class="win-note">Run the portable <code>Skimd.exe</code> desktop app to manage Windows PATH and <code>.md</code> file associations.</div>
        </div>`;

    this.contentEl.innerHTML = `
      <div class="settings-section-header">Windows &amp; Info</div>
      ${windowsCard}

      <div class="settings-card">
        <div class="settings-card-title">Keyboard Shortcuts</div>
        <div class="shortcut-grid">
          <span>Open file</span><kbd class="shortcut-kbd">Ctrl+O</kbd>
          <span>New document</span><kbd class="shortcut-kbd">Ctrl+N</kbd>
          <span>Save / Save As</span><kbd class="shortcut-kbd">Ctrl+S / Ctrl+Shift+S</kbd>
          <span>Toggle sidebar</span><kbd class="shortcut-kbd">Ctrl+B / Ctrl+\\</kbd>
          <span>Read / Split / Edit</span><kbd class="shortcut-kbd">Ctrl+1 / 2 / 3</kbd>
          <span>Find in document</span><kbd class="shortcut-kbd">Ctrl+F</kbd>
          <span>Open link in Preview</span><kbd class="shortcut-kbd">Ctrl+Click</kbd>
          <span>Settings</span><kbd class="shortcut-kbd">Ctrl+,</kbd>
        </div>
      </div>

      <div class="settings-card">
        <div class="setting-row">
          <div class="brand-mark">${SKIMD_LOGO_SVG}<span>Skimd v1.0.0-beta.2</span></div>
          <span class="pill-badge">v1 Beta</span>
        </div>
      </div>
    `;

    this.contentEl.querySelector('#win-reg-all')?.addEventListener('click', async () => {
      this.busyWindows = true;
      this.render(this.lastSettings, winStatus, isNativeHost);
      try {
        await this.callbacks.onRegisterWindows({ path: true, md: true, structured: false });
      } finally {
        this.busyWindows = false;
      }
    });

    this.contentEl.querySelector('#win-reg-structured')?.addEventListener('click', async () => {
      this.busyWindows = true;
      this.render(this.lastSettings, winStatus, isNativeHost);
      try {
        await this.callbacks.onRegisterWindows({ path: true, md: true, structured: true });
      } finally {
        this.busyWindows = false;
      }
    });

    this.contentEl.querySelector('#win-unreg')?.addEventListener('click', async () => {
      this.busyWindows = true;
      this.render(this.lastSettings, winStatus, isNativeHost);
      try {
        await this.callbacks.onUnregisterWindows();
      } finally {
        this.busyWindows = false;
      }
    });

    this.contentEl.querySelector('#win-open-defaults')?.addEventListener('click', () => {
      this.callbacks.onOpenDefaultApps();
    });
  }
}
