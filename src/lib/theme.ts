import type { AppSettings, CustomThemeColors, ThemeId } from '../types.ts';

export interface ThemePreset {
  id: string;
  name: string;
  colors: CustomThemeColors;
}

export const BUILTIN_THEME_COLORS: Record<'graphite' | 'black' | 'light', CustomThemeColors> = {
  graphite: {
    bgBase: '#121212',
    bgSurface: '#1c1c1c',
    bgElevated: '#272727',
    textPrimary: '#f5f5f5',
    accent: '#ffffff'
  },
  black: {
    bgBase: '#000000',
    bgSurface: '#121212',
    bgElevated: '#202020',
    textPrimary: '#ffffff',
    accent: '#ffffff'
  },
  light: {
    bgBase: '#f3f3f3',
    bgSurface: '#ffffff',
    bgElevated: '#e7e7e7',
    textPrimary: '#141414',
    accent: '#181818'
  }
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'graphite',
    name: 'Graphite',
    colors: {
      bgBase: '#121212',
      bgSurface: '#1c1c1c',
      bgElevated: '#282828',
      textPrimary: '#f5f5f5',
      accent: '#ffffff'
    }
  },
  {
    id: 'amoled',
    name: 'AMOLED Black',
    colors: {
      bgBase: '#000000',
      bgSurface: '#121212',
      bgElevated: '#212121',
      textPrimary: '#ffffff',
      accent: '#e5e5e5'
    }
  },
  {
    id: 'charcoal',
    name: 'Warm Charcoal',
    colors: {
      bgBase: '#191716',
      bgSurface: '#23201e',
      bgElevated: '#312d2a',
      textPrimary: '#f5f2ef',
      accent: '#e6b89c'
    }
  },
  {
    id: 'clean-light',
    name: 'Clean Light',
    colors: {
      bgBase: '#f3f3f3',
      bgSurface: '#ffffff',
      bgElevated: '#e6e6e6',
      textPrimary: '#141414',
      accent: '#181818'
    }
  },
  {
    id: 'soft-stone',
    name: 'Soft Stone',
    colors: {
      bgBase: '#edeae4',
      bgSurface: '#f8f6f2',
      bgElevated: '#e2ddd4',
      textPrimary: '#1f1d1a',
      accent: '#3d3730'
    }
  },
  {
    id: 'sage-slate',
    name: 'Sage Slate',
    colors: {
      bgBase: '#141917',
      bgSurface: '#1c2320',
      bgElevated: '#27312d',
      textPrimary: '#eef3f0',
      accent: '#9bd4b8'
    }
  }
];

export const HIGHLIGHT_SWATCHES: Array<{ label: string; value: string }> = [
  { label: 'Mono', value: '' },
  { label: 'Sky', value: '#7dd3fc' },
  { label: 'Sage', value: '#86efac' },
  { label: 'Amber', value: '#fcd34d' },
  { label: 'Lavender', value: '#c4b5fd' },
  { label: 'Rose', value: '#fda4af' }
];

export function normalizeThemeId(raw: string | undefined): ThemeId {
  switch (raw) {
    case 'graphite':
    case 'black':
    case 'light':
    case 'system':
    case 'custom':
      return raw;
    case 'obsidian':
      return 'graphite';
    case 'midnight':
      return 'black';
    case 'paper':
      return 'light';
    default:
      return 'graphite';
  }
}

function parseHex(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(clean)) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16)
    ];
  }
  if (/^[0-9a-f]{6}$/i.test(clean)) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16)
    ];
  }
  return [18, 18, 18];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
  );
}

export function mixHex(hexA: string, hexB: string, weightB: number): string {
  const [r1, g1, b1] = parseHex(hexA);
  const [r2, g2, b2] = parseHex(hexB);
  const w = Math.max(0, Math.min(1, weightB));
  return toHex(r1 + (r2 - r1) * w, g1 + (g2 - g1) * w, b1 + (b2 - b1) * w);
}

export function isLightColor(hex: string): boolean {
  const [r, g, b] = parseHex(hex);
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return lum > 0.42;
}

export function getContrastText(bgHex: string): string {
  return isLightColor(bgHex) ? '#141414' : '#ffffff';
}

export function deriveHighlightOverrideVars(
  bgBase: string,
  textPrimary: string,
  codeHighlightColor: string,
  tipColor: string
): Record<string, string> {
  const light = isLightColor(bgBase);
  const out: Record<string, string> = {};

  if (codeHighlightColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(codeHighlightColor.trim())) {
    const c = codeHighlightColor.trim();
    out['--hljs-str'] = c;
    out['--hljs-attr'] = mixHex(c, textPrimary, 0.25);
    out['--hljs-kw'] = mixHex(c, textPrimary, 0.45);
    out['--hljs-num'] = mixHex(c, textPrimary, 0.15);
  }

  if (tipColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(tipColor.trim())) {
    const t = tipColor.trim();
    out['--tip-accent'] = t;
    out['--tip-on-accent'] = getContrastText(t);
    out['--tip-bg'] = mixHex(bgBase, t, light ? 0.14 : 0.2);
  }

  return out;
}

export function deriveCustomThemeVars(colors: CustomThemeColors): Record<string, string> {
  const light = isLightColor(colors.bgBase);
  const onAccent = getContrastText(colors.accent);
  const textSecondary = mixHex(colors.textPrimary, colors.bgBase, 0.34);
  const textMuted = mixHex(colors.textPrimary, colors.bgBase, 0.56);
  const bgHover = mixHex(colors.bgElevated, colors.textPrimary, 0.08);
  const bgActive = mixHex(colors.bgElevated, colors.accent, 0.16);
  const codeBg = light
    ? mixHex(colors.bgBase, '#000000', 0.04)
    : mixHex(colors.bgBase, colors.bgSurface, 0.45);
  const quoteBg = colors.bgSurface;
  const borderSubtle = light ? 'rgba(0, 0, 0, 0.07)' : 'rgba(255, 255, 255, 0.07)';
  const borderStrong = light ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255, 255, 255, 0.14)';

  return {
    'color-scheme': light ? 'light' : 'dark',
    '--bg-base': colors.bgBase,
    '--bg-surface': colors.bgSurface,
    '--bg-elevated': colors.bgElevated,
    '--bg-hover': bgHover,
    '--bg-active': bgActive,
    '--border-subtle': borderSubtle,
    '--border-strong': borderStrong,
    '--text-primary': colors.textPrimary,
    '--text-secondary': textSecondary,
    '--text-muted': textMuted,
    '--accent': colors.accent,
    '--on-accent': onAccent,
    '--accent-soft': mixHex(colors.bgElevated, colors.accent, 0.22),
    '--code-bg': codeBg,
    '--quote-bg': quoteBg,
    '--tip-accent': colors.accent,
    '--tip-on-accent': onAccent,
    '--tip-bg': colors.bgSurface,
    '--success': textSecondary,
    '--success-bg': colors.bgElevated,
    '--warning': light ? '#9a6312' : '#d6a456',
    '--warning-bg': light ? '#f8ecd6' : '#2c2419',
    '--danger': light ? '#b53737' : '#de7a7a',
    '--danger-bg': light ? '#f9e2e2' : '#2e1d1d',
    '--note-bg': colors.bgSurface,
    '--important-bg': colors.bgElevated,
    '--important-fg': colors.textPrimary,
    '--hljs-kw': colors.textPrimary,
    '--hljs-str': mixHex(colors.textPrimary, colors.bgBase, 0.16),
    '--hljs-num': textSecondary,
    '--hljs-fn': colors.textPrimary,
    '--hljs-com': textMuted,
    '--hljs-attr': textSecondary
  };
}

const MANAGED_VAR_KEYS = [
  ...Object.keys(
    deriveCustomThemeVars({
      bgBase: '#121212',
      bgSurface: '#1c1c1c',
      bgElevated: '#282828',
      textPrimary: '#f5f5f5',
      accent: '#ffffff'
    })
  ),
  '--tip-accent',
  '--tip-on-accent',
  '--tip-bg'
];

export function applyThemeToDocument(
  html: HTMLElement,
  settings: AppSettings
): { isLight: boolean; bgHex: string; resolvedTheme: ThemeId } {
  let resolved = normalizeThemeId(settings.theme);
  if (resolved === 'system') {
    const prefersDark =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    resolved = prefersDark ? 'graphite' : 'light';
  }

  for (const key of MANAGED_VAR_KEYS) {
    html.style.removeProperty(key);
  }

  html.dataset.theme = resolved;
  html.dataset.font = settings.fontPairing;
  html.style.setProperty('--doc-font-size', `${settings.fontSize}px`);
  html.style.setProperty('--doc-line-height', String(settings.lineHeight));
  html.style.setProperty('--doc-max-width', settings.maxWidth);

  let bgHex = '#121212';
  let textPrimary = '#f5f5f5';
  let isLight = false;

  if (resolved === 'custom') {
    const vars = deriveCustomThemeVars(settings.customTheme);
    for (const [key, val] of Object.entries(vars)) {
      html.style.setProperty(key, val);
    }
    bgHex = settings.customTheme.bgBase;
    textPrimary = settings.customTheme.textPrimary;
    isLight = isLightColor(bgHex);
  } else if (resolved === 'light') {
    bgHex = '#f3f3f3';
    textPrimary = '#141414';
    isLight = true;
  } else if (resolved === 'black') {
    bgHex = '#000000';
    textPrimary = '#ffffff';
    isLight = false;
  }

  const overrides = deriveHighlightOverrideVars(
    bgHex,
    textPrimary,
    settings.codeHighlightColor ?? '',
    settings.tipColor ?? ''
  );
  for (const [key, val] of Object.entries(overrides)) {
    html.style.setProperty(key, val);
  }

  return { isLight, bgHex, resolvedTheme: resolved };
}
