import type { AppThemeId } from '../types';

export interface ThemePreset {
  id: AppThemeId;
  label: string;
  desc: string;
  mode: 'light' | 'dark';
  swatch: string;
  surface: string;
  accentRgb: [number, number, number];
}

export const THEME_PRESETS: ThemePreset[] = [
  // Light Themes (8)
  {
    id: 'indigo',
    label: 'Indigo Modern',
    desc: 'Terang bersih aksen indigo',
    mode: 'light',
    swatch: '#4F46E5',
    surface: '#F8FAFC',
    accentRgb: [79, 70, 229],
  },
  {
    id: 'emerald',
    label: 'Hijau Zamrud',
    desc: 'Nuansa segar hijau sekolah',
    mode: 'light',
    swatch: '#059669',
    surface: '#F8FAFC',
    accentRgb: [5, 150, 105],
  },
  {
    id: 'sky',
    label: 'Biru Langit',
    desc: 'Terang cerah biru profesional',
    mode: 'light',
    swatch: '#0284C7',
    surface: '#F8FAFC',
    accentRgb: [2, 132, 199],
  },
  {
    id: 'teal',
    label: 'Teal Samudra',
    desc: 'Sejuk modern hijau kebiruan',
    mode: 'light',
    swatch: '#0D9488',
    surface: '#F8FAFC',
    accentRgb: [13, 148, 136],
  },
  {
    id: 'violet',
    label: 'Ungu Violet',
    desc: 'Kreatif elegan nuansa ungu',
    mode: 'light',
    swatch: '#7C3AED',
    surface: '#F8FAFC',
    accentRgb: [124, 58, 237],
  },
  {
    id: 'rose',
    label: 'Merah Mawar',
    desc: 'Enerjik dengan aksen merah',
    mode: 'light',
    swatch: '#E11D48',
    surface: '#F8FAFC',
    accentRgb: [225, 29, 72],
  },
  {
    id: 'amber',
    label: 'Emas Hangat',
    desc: 'Klasik elegan bernuansa emas',
    mode: 'light',
    swatch: '#D97706',
    surface: '#F8FAFC',
    accentRgb: [217, 119, 6],
  },
  {
    id: 'slate',
    label: 'Abu Grafit',
    desc: 'Minimalis monokrom formal',
    mode: 'light',
    swatch: '#334155',
    surface: '#F8FAFC',
    accentRgb: [51, 65, 85],
  },

  // Dark Themes (6)
  {
    id: 'dark',
    label: 'Gelap Biru Langit',
    desc: 'Mode malam aksen biru cerah',
    mode: 'dark',
    swatch: '#38BDF8',
    surface: '#0B1120',
    accentRgb: [2, 132, 199],
  },
  {
    id: 'dark-indigo',
    label: 'Gelap Midnight Indigo',
    desc: 'Mode malam aksen indigo lembut',
    mode: 'dark',
    swatch: '#818CF8',
    surface: '#0B1021',
    accentRgb: [79, 70, 229],
  },
  {
    id: 'dark-emerald',
    label: 'Gelap Hutan Zamrud',
    desc: 'Mode malam aksen hijau zamrud',
    mode: 'dark',
    swatch: '#34D399',
    surface: '#071510',
    accentRgb: [5, 150, 105],
  },
  {
    id: 'dark-violet',
    label: 'Gelap Nebula Ungu',
    desc: 'Mode malam aksen violet modern',
    mode: 'dark',
    swatch: '#A78BFA',
    surface: '#110C1D',
    accentRgb: [124, 58, 237],
  },
  {
    id: 'dark-rose',
    label: 'Gelap Crimson Velvet',
    desc: 'Mode malam aksen merah mawar',
    mode: 'dark',
    swatch: '#FB7185',
    surface: '#170B11',
    accentRgb: [225, 29, 72],
  },
  {
    id: 'dark-amber',
    label: 'Gelap Obsidian Emas',
    desc: 'Mode malam aksen emas hangat',
    mode: 'dark',
    swatch: '#FBBF24',
    surface: '#14110B',
    accentRgb: [217, 119, 6],
  },
];

const THEME_ID_SET = new Set<string>(THEME_PRESETS.map((t) => t.id));

export function isValidThemeId(value: unknown): value is AppThemeId {
  return typeof value === 'string' && THEME_ID_SET.has(value);
}

export function normalizeThemeId(value: unknown, fallback: AppThemeId = 'indigo'): AppThemeId {
  return isValidThemeId(value) ? value : fallback;
}

export function isDarkTheme(tema?: AppThemeId): boolean {
  if (!tema) return false;
  return tema === 'dark' || tema.startsWith('dark-');
}

export function getThemeAccentRgbFromCatalog(tema?: AppThemeId): [number, number, number] {
  const match = THEME_PRESETS.find((t) => t.id === tema);
  return match ? match.accentRgb : [79, 70, 229];
}
