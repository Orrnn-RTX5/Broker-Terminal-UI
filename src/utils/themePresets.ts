export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemeContrast = 'default' | 'strong';

export type ThemePresetCategory =
  | 'Core & Classic'
  | 'Standard & High Contrast'
  | 'GitHub & Material'
  | 'Signature & Studio';

export type LightThemePresetId =
  | 'default-light'
  | 'catppuccin'
  | 'gruvbox-material'
  | 'one-light'
  | 'solarized-light'
  | 'light-modern'
  | 'light-plus'
  | 'quiet-light'
  | 'hc-light'
  | 'github-light'
  | 'github-light-high-contrast'
  | 'github-light-colorblind'
  | 'material-lighter'
  | 'bluloco-light'
  | 'min-light'
  | 'ayu-light'
  | 'rose-pine-dawn'
  | 'everforest-light'
  | 'tokyo-night-light'
  | 'night-owl-light'
  | 'horizon-bright'
  | 'kanagawa-lotus'
  | 'nord-light'
  | 'winter-is-coming-light'
  | 'dracula-light'
  | 'monokai-light'
  | 'cobalt-light'
  | 'palenight-light'
  | 'abyss-light'
  | 'vesper-light';

export type DarkThemePresetId =
  | 'default-dark'
  | 'catppuccin'
  | 'dracula'
  | 'gruvbox-material'
  | 'monokai'
  | 'one-dark-pro'
  | 'tokyo-night'
  | 'solarized-dark'
  | 'vesper'
  | 'dark-modern'
  | 'dark-plus'
  | 'monokai-dimmed'
  | 'abyss'
  | 'kimbie-dark'
  | 'tomorrow-night-blue'
  | 'crimson-dark'
  | 'hc-black'
  | 'github-dark'
  | 'github-dark-dimmed'
  | 'github-dark-high-contrast'
  | 'material-palenight'
  | 'material-darker'
  | 'material-ocean'
  | 'rainglow'
  | 'min-dark'
  | 'night-owl'
  | 'nord'
  | 'synthwave-84'
  | 'cobalt2'
  | 'ayu-dark'
  | 'ayu-mirage'
  | 'horizon-dark'
  | 'rose-pine'
  | 'rose-pine-moon'
  | 'everforest-dark'
  | 'kanagawa-wave'
  | 'kanagawa-dragon'
  | 'tokyo-night-storm'
  | 'catppuccin-macchiato'
  | 'catppuccin-frappe'
  | 'shades-of-purple'
  | 'winter-is-coming-dark'
  | 'poimandres'
  | 'andromeda'
  | 'moonlight'
  | 'panda-syntax';

export interface ThemeColorPalette {
  background: string;
  foreground: string;
  accent: string;
}

export interface ThemePresetDefinition<TId extends string = string> extends ThemeColorPalette {
  id: TId;
  label: string;
  category?: ThemePresetCategory;
  description?: string;
}

export interface ThemeVariantSettings<TPresetId extends string = string> extends ThemeColorPalette {
  preset: TPresetId;
}

export interface ThemeAppearanceState {
  themeMode: ThemeMode;
  contrast: ThemeContrast;
  light: ThemeVariantSettings<LightThemePresetId>;
  dark: ThemeVariantSettings<DarkThemePresetId>;
}

export const RTX_THEME_APPEARANCE_STORAGE_KEY = 'rtx5-theme-appearance';
export const RTX_THEME_APPEARANCE_CHANGE_EVENT = 'rtx:theme-appearance-change';

export const THEME_PRESET_CATEGORIES: readonly ThemePresetCategory[] = [
  'Core & Classic',
  'Standard & High Contrast',
  'GitHub & Material',
  'Signature & Studio',
] as const;

export const LIGHT_THEME_PRESETS: readonly ThemePresetDefinition<LightThemePresetId>[] = [
  // Core & Classic (original 5 presets)
  {
    id: 'default-light',
    label: 'Default Light',
    background: '#F9F9F9',
    foreground: '#101010',
    accent: '#007ACC',
    category: 'Core & Classic',
    description: 'Standard high-clarity neutral daylight surface',
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    background: '#EFF1F5',
    foreground: '#4C4F69',
    accent: '#8839EF',
    category: 'Core & Classic',
    description: 'Catppuccin Latte soothing pastel daylight',
  },
  {
    id: 'gruvbox-material',
    label: 'Gruvbox Material',
    background: '#FBF1C7',
    foreground: '#3C3836',
    accent: '#D65D0E',
    category: 'Core & Classic',
    description: 'Warm retro cream paper with earthy contrast',
  },
  {
    id: 'one-light',
    label: 'One Light',
    background: '#FAFAFA',
    foreground: '#383A42',
    accent: '#4078F2',
    category: 'Core & Classic',
    description: 'Balanced crisp white and cobalt palette',
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    background: '#FDF6E3',
    foreground: '#586E75',
    accent: '#268BD2',
    category: 'Core & Classic',
    description: 'Precision warm cream daylight for low eye strain',
  },

  // Standard & High Contrast Light Themes
  {
    id: 'light-modern',
    label: 'Light Modern',
    background: '#FFFFFF',
    foreground: '#3B3B3B',
    accent: '#005FB8',
    category: 'Standard & High Contrast',
    description: 'Clean modern white workspace with royal blue focus',
  },
  {
    id: 'light-plus',
    label: 'Light+',
    background: '#FFFFFF',
    foreground: '#000000',
    accent: '#0066BF',
    category: 'Standard & High Contrast',
    description: 'Classic high-definition white surface',
  },
  {
    id: 'quiet-light',
    label: 'Quiet Light',
    background: '#F5F5F5',
    foreground: '#333333',
    accent: '#7A3E9D',
    category: 'Standard & High Contrast',
    description: 'Soft low-glare mist gray with amethyst accent',
  },
  {
    id: 'hc-light',
    label: 'High Contrast Light',
    background: '#FFFFFF',
    foreground: '#0F172A',
    accent: '#0F4A85',
    category: 'Standard & High Contrast',
    description: 'Maximum-contrast accessibility daylight surface',
  },
  {
    id: 'abyss-light',
    label: 'Abyss Light',
    background: '#F0F4F8',
    foreground: '#102A43',
    accent: '#1D4ED8',
    category: 'Standard & High Contrast',
    description: 'Cool maritime ice blue daylight surface',
  },

  // GitHub & Material Light Themes
  {
    id: 'github-light',
    label: 'GitHub Light Default',
    background: '#FFFFFF',
    foreground: '#1F2328',
    accent: '#0969DA',
    category: 'GitHub & Material',
    description: 'Clean neutral daylight with cobalt blue accent',
  },
  {
    id: 'github-light-high-contrast',
    label: 'GitHub Light High Contrast',
    background: '#FFFFFF',
    foreground: '#0E1116',
    accent: '#0349B4',
    category: 'GitHub & Material',
    description: 'Razor-sharp ink on pure white surface',
  },
  {
    id: 'github-light-colorblind',
    label: 'GitHub Light Colorblind',
    background: '#FFFFFF',
    foreground: '#1F2328',
    accent: '#0550AE',
    category: 'GitHub & Material',
    description: 'Color-vision accessible daylight blue palette',
  },
  {
    id: 'material-lighter',
    label: 'Material Lighter',
    background: '#FAFAFA',
    foreground: '#546E7A',
    accent: '#00BCD4',
    category: 'GitHub & Material',
    description: 'Material Design cool slate and cyan surface',
  },
  {
    id: 'palenight-light',
    label: 'Material Palenight Light',
    background: '#F5F3FF',
    foreground: '#312E81',
    accent: '#7C3AED',
    category: 'GitHub & Material',
    description: 'Soft lavender paper with royal violet accent',
  },
  {
    id: 'bluloco-light',
    label: 'Bluloco Light',
    background: '#F9F9F9',
    foreground: '#383A42',
    accent: '#0098DD',
    category: 'GitHub & Material',
    description: 'Airy neutral light with crisp sky blue accent',
  },
  {
    id: 'min-light',
    label: 'Min Light',
    background: '#FFFFFF',
    foreground: '#212121',
    accent: '#1976D2',
    category: 'GitHub & Material',
    description: 'Distraction-free minimalist white palette',
  },

  // Signature & Studio Light Themes
  {
    id: 'ayu-light',
    label: 'Ayu Light',
    background: '#F8F9FA',
    foreground: '#5C6166',
    accent: '#FF9940',
    category: 'Signature & Studio',
    description: 'Soft paper canvas with warm amber highlights',
  },
  {
    id: 'rose-pine-dawn',
    label: 'Rosé Pine Dawn',
    background: '#FAF4ED',
    foreground: '#575279',
    accent: '#D7827E',
    category: 'Signature & Studio',
    description: 'Morning parchment with muted rose gold',
  },
  {
    id: 'everforest-light',
    label: 'Everforest Light',
    background: '#FDF6E3',
    foreground: '#5C6A72',
    accent: '#8DA101',
    category: 'Signature & Studio',
    description: 'Organic botanical cream and sage green',
  },
  {
    id: 'tokyo-night-light',
    label: 'Tokyo Night Light',
    background: '#D5D6DB',
    foreground: '#343B58',
    accent: '#34548A',
    category: 'Signature & Studio',
    description: 'Cool silver-blue overcast daylight surface',
  },
  {
    id: 'night-owl-light',
    label: 'Night Owl Light',
    background: '#FBFBFB',
    foreground: '#403F53',
    accent: '#2AA298',
    category: 'Signature & Studio',
    description: 'High-clarity daytime alabaster and teal',
  },
  {
    id: 'horizon-bright',
    label: 'Horizon Bright',
    background: '#FDF0ED',
    foreground: '#332D31',
    accent: '#DA103F',
    category: 'Signature & Studio',
    description: 'Warm sunrise blush with vivid crimson accent',
  },
  {
    id: 'kanagawa-lotus',
    label: 'Kanagawa Lotus',
    background: '#F2ECBC',
    foreground: '#545464',
    accent: '#4D699B',
    category: 'Signature & Studio',
    description: 'Traditional washi parchment and indigo ink',
  },
  {
    id: 'nord-light',
    label: 'Nord Light',
    background: '#ECEFF4',
    foreground: '#2E3440',
    accent: '#5E81AC',
    category: 'Signature & Studio',
    description: 'Arctic snow-storm white with frost blue',
  },
  {
    id: 'winter-is-coming-light',
    label: 'Winter is Coming Light',
    background: '#FFFFFF',
    foreground: '#236EBF',
    accent: '#007ACC',
    category: 'Signature & Studio',
    description: 'Crisp glacial white with cobalt typography',
  },
  {
    id: 'dracula-light',
    label: 'Dracula Alucard',
    background: '#FFFBEB',
    foreground: '#1F1F1F',
    accent: '#644AC9',
    category: 'Signature & Studio',
    description: 'Daylight counterpart to Dracula with royal purple',
  },
  {
    id: 'monokai-light',
    label: 'Monokai Pro Light',
    background: '#FAF4F2',
    foreground: '#29242A',
    accent: '#F82570',
    category: 'Signature & Studio',
    description: 'Warm studio ivory with vibrant magenta accent',
  },
  {
    id: 'cobalt-light',
    label: 'Cobalt Daylight',
    background: '#F0F7FF',
    foreground: '#0F2942',
    accent: '#0066CC',
    category: 'Signature & Studio',
    description: 'Crisp ocean-breeze daylight with deep navy text',
  },
  {
    id: 'vesper-light',
    label: 'Vesper Daylight',
    background: '#F7F5F0',
    foreground: '#1C1917',
    accent: '#D97706',
    category: 'Signature & Studio',
    description: 'Minimalist warm stone with amber-gold accent',
  },
] as const;

export const DARK_THEME_PRESETS: readonly ThemePresetDefinition<DarkThemePresetId>[] = [
  // Core & Classic (original 9 presets)
  {
    id: 'default-dark',
    label: 'Default Dark',
    background: '#101010',
    foreground: '#CCCCCC',
    accent: '#007ACC',
    category: 'Core & Classic',
    description: 'Standard carbon-black professional dark surface',
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    background: '#1E1E2E',
    foreground: '#CDD6F4',
    accent: '#CBA6F7',
    category: 'Core & Classic',
    description: 'Catppuccin Mocha warm pastel midnight',
  },
  {
    id: 'dracula',
    label: 'Dracula',
    background: '#282A36',
    foreground: '#F8F8F2',
    accent: '#BD93F9',
    category: 'Core & Classic',
    description: 'Iconic gothic slate with electric purple accent',
  },
  {
    id: 'gruvbox-material',
    label: 'Gruvbox Material',
    background: '#282828',
    foreground: '#D4BE98',
    accent: '#E78A4E',
    category: 'Core & Classic',
    description: 'Warm retro charcoal with earthy amber tones',
  },
  {
    id: 'monokai',
    label: 'Monokai',
    background: '#272822',
    foreground: '#F8F8F2',
    accent: '#A6E22E',
    category: 'Core & Classic',
    description: 'Classic olive-charcoal dark with vibrant lime',
  },
  {
    id: 'one-dark-pro',
    label: 'One Dark Pro',
    background: '#282C34',
    foreground: '#ABB2BF',
    accent: '#61AFEF',
    category: 'Core & Classic',
    description: 'Balanced cool slate dark with sky blue accent',
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    background: '#1A1B26',
    foreground: '#C0CAF5',
    accent: '#7AA2F7',
    category: 'Core & Classic',
    description: 'Downtown Tokyo midnight blue and neon sky',
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    background: '#002B36',
    foreground: '#839496',
    accent: '#268BD2',
    category: 'Core & Classic',
    description: 'Deep oceanic teal-blue for reduced eye strain',
  },
  {
    id: 'vesper',
    label: 'Vesper',
    background: '#101010',
    foreground: '#FFFFFF',
    accent: '#FFC799',
    category: 'Core & Classic',
    description: 'Minimalist obsidian dark with warm peach accent',
  },

  // Standard & High Contrast Dark Themes
  {
    id: 'dark-modern',
    label: 'Dark Modern',
    background: '#1F1F1F',
    foreground: '#CCCCCC',
    accent: '#0078D4',
    category: 'Standard & High Contrast',
    description: 'Modern neutral charcoal dark with azure focus',
  },
  {
    id: 'dark-plus',
    label: 'Dark+',
    background: '#1E1E1E',
    foreground: '#D4D4D4',
    accent: '#007ACC',
    category: 'Standard & High Contrast',
    description: 'Classic graphite dark workspace',
  },
  {
    id: 'monokai-dimmed',
    label: 'Monokai Dimmed',
    background: '#1E1E1E',
    foreground: '#C5C8C6',
    accent: '#569CD6',
    category: 'Standard & High Contrast',
    description: 'Subdued low-fatigue charcoal and steel blue',
  },
  {
    id: 'abyss',
    label: 'Abyss',
    background: '#000C18',
    foreground: '#6688CC',
    accent: '#2B4F81',
    category: 'Standard & High Contrast',
    description: 'Deep trench midnight blue for low-light trading',
  },
  {
    id: 'kimbie-dark',
    label: 'Kimbie Dark',
    background: '#221A0F',
    foreground: '#D3AF86',
    accent: '#DC3958',
    category: 'Standard & High Contrast',
    description: 'Warm roasted espresso and crimson',
  },
  {
    id: 'tomorrow-night-blue',
    label: 'Tomorrow Night Blue',
    background: '#002451',
    foreground: '#FFFFFF',
    accent: '#BBDAFF',
    category: 'Standard & High Contrast',
    description: 'Vivid royal navy blue with crisp white text',
  },
  {
    id: 'crimson-dark',
    label: 'Crimson Night',
    background: '#390000',
    foreground: '#F8F8F8',
    accent: '#CC3333',
    category: 'Standard & High Contrast',
    description: 'Deep ruby and scarlet night palette',
  },
  {
    id: 'hc-black',
    label: 'High Contrast Dark',
    background: '#000000',
    foreground: '#FFFFFF',
    accent: '#F38518',
    category: 'Standard & High Contrast',
    description: 'Pure pitch black maximum-contrast accessibility',
  },

  // GitHub & Material Dark Themes
  {
    id: 'github-dark',
    label: 'GitHub Dark Default',
    background: '#0D1117',
    foreground: '#E6EDF3',
    accent: '#2F81F7',
    category: 'GitHub & Material',
    description: 'Deep slate night with electric blue highlights',
  },
  {
    id: 'github-dark-dimmed',
    label: 'GitHub Dark Dimmed',
    background: '#22272E',
    foreground: '#ADBAC7',
    accent: '#539BF5',
    category: 'GitHub & Material',
    description: 'Soft twilight steel for extended sessions',
  },
  {
    id: 'github-dark-high-contrast',
    label: 'GitHub Dark High Contrast',
    background: '#0A0C10',
    foreground: '#F0F6FC',
    accent: '#71B7FF',
    category: 'GitHub & Material',
    description: 'Ultra-crisp obsidian dark contrast',
  },
  {
    id: 'material-palenight',
    label: 'Material Palenight',
    background: '#292D3E',
    foreground: '#A6ACCD',
    accent: '#C792EA',
    category: 'GitHub & Material',
    description: 'Material Design velvet indigo and orchid purple',
  },
  {
    id: 'material-darker',
    label: 'Material Darker',
    background: '#212121',
    foreground: '#EEFFFF',
    accent: '#FF5370',
    category: 'GitHub & Material',
    description: 'Pure carbon dark with coral red highlights',
  },
  {
    id: 'material-ocean',
    label: 'Material Ocean',
    background: '#0F111A',
    foreground: '#8F93A2',
    accent: '#84FFFF',
    category: 'GitHub & Material',
    description: 'Deep abyssal slate with electric cyan accent',
  },
  {
    id: 'rainglow',
    label: 'Rainglow Dark',
    background: '#181A1F',
    foreground: '#D7DAE0',
    accent: '#528BFF',
    category: 'GitHub & Material',
    description: 'Balanced studio dark with cobalt focus',
  },
  {
    id: 'min-dark',
    label: 'Min Dark',
    background: '#1F1F1F',
    foreground: '#B3B3B3',
    accent: '#BB86FC',
    category: 'GitHub & Material',
    description: 'Distraction-free matte dark with violet accent',
  },

  // Signature & Studio Dark Themes
  {
    id: 'night-owl',
    label: 'Night Owl',
    background: '#011627',
    foreground: '#D6DEEB',
    accent: '#82AAFF',
    category: 'Signature & Studio',
    description: 'Low-light midnight blue with periwinkle glow',
  },
  {
    id: 'nord',
    label: 'Nord',
    background: '#2E3440',
    foreground: '#D8DEE9',
    accent: '#88C0D0',
    category: 'Signature & Studio',
    description: 'Arctic polar night slate with frost cyan',
  },
  {
    id: 'synthwave-84',
    label: "SynthWave '84",
    background: '#262335',
    foreground: '#F92AAD',
    accent: '#36F9F6',
    category: 'Signature & Studio',
    description: 'Retro outrun violet with neon cyan and magenta',
  },
  {
    id: 'cobalt2',
    label: 'Cobalt2',
    background: '#193549',
    foreground: '#FFFFFF',
    accent: '#FFC600',
    category: 'Signature & Studio',
    description: 'High-impact oceanic blue and cyber gold',
  },
  {
    id: 'ayu-dark',
    label: 'Ayu Dark',
    background: '#0B0E14',
    foreground: '#BFBDB6',
    accent: '#E6B450',
    category: 'Signature & Studio',
    description: 'Deep obsidian night with warm goldenrod accent',
  },
  {
    id: 'ayu-mirage',
    label: 'Ayu Mirage',
    background: '#1F2430',
    foreground: '#CCCAC2',
    accent: '#FFCC66',
    category: 'Signature & Studio',
    description: 'Soft indigo dusk with honey amber highlights',
  },
  {
    id: 'horizon-dark',
    label: 'Horizon Dark',
    background: '#1C1E26',
    foreground: '#CBCCC6',
    accent: '#E95678',
    category: 'Signature & Studio',
    description: 'Warm twilight charcoal with sunset coral pink',
  },
  {
    id: 'rose-pine',
    label: 'Rosé Pine',
    background: '#191724',
    foreground: '#E0DEF4',
    accent: '#EBBCBA',
    category: 'Signature & Studio',
    description: 'Soho pine dark velvet with soft rose gold',
  },
  {
    id: 'rose-pine-moon',
    label: 'Rosé Pine Moon',
    background: '#232136',
    foreground: '#E0DEF4',
    accent: '#EA9A97',
    category: 'Signature & Studio',
    description: 'Moonlit plum slate with warm coral rose',
  },
  {
    id: 'everforest-dark',
    label: 'Everforest Dark',
    background: '#2B3339',
    foreground: '#D3C6AA',
    accent: '#A7C080',
    category: 'Signature & Studio',
    description: 'Soothing woodland dark moss and warm parchment',
  },
  {
    id: 'kanagawa-wave',
    label: 'Kanagawa Wave',
    background: '#1F1F28',
    foreground: '#DCD7BA',
    accent: '#7E9CD8',
    category: 'Signature & Studio',
    description: 'Japanese sumi ink wave with crystal blue',
  },
  {
    id: 'kanagawa-dragon',
    label: 'Kanagawa Dragon',
    background: '#181616',
    foreground: '#C5C9C5',
    accent: '#8BA4B0',
    category: 'Signature & Studio',
    description: 'Volcanic charcoal iron with muted steel blue',
  },
  {
    id: 'tokyo-night-storm',
    label: 'Tokyo Night Storm',
    background: '#24283B',
    foreground: '#C0CAF5',
    accent: '#7AA2F7',
    category: 'Signature & Studio',
    description: 'Stormy midnight indigo with electric sky blue',
  },
  {
    id: 'catppuccin-macchiato',
    label: 'Catppuccin Macchiato',
    background: '#24273A',
    foreground: '#CAD3F5',
    accent: '#8AADF4',
    category: 'Signature & Studio',
    description: 'Rich espresso dark with periwinkle blue',
  },
  {
    id: 'catppuccin-frappe',
    label: 'Catppuccin Frappé',
    background: '#303446',
    foreground: '#C6D0F5',
    accent: '#8CAAEE',
    category: 'Signature & Studio',
    description: 'Muted dusk slate with soft lavender blue',
  },
  {
    id: 'shades-of-purple',
    label: 'Shades of Purple',
    background: '#2D2B55',
    foreground: '#FFFFFF',
    accent: '#FAD000',
    category: 'Signature & Studio',
    description: 'Royal ultraviolet dark with electric yellow',
  },
  {
    id: 'winter-is-coming-dark',
    label: 'Winter is Coming Dark',
    background: '#011627',
    foreground: '#D6DEEB',
    accent: '#00BFF9',
    category: 'Signature & Studio',
    description: 'Deep glacial navy with icy cyan highlights',
  },
  {
    id: 'poimandres',
    label: 'Poimandres',
    background: '#1B1E28',
    foreground: '#A6ACCD',
    accent: '#5DE4C7',
    category: 'Signature & Studio',
    description: 'Minimalist cool slate with mint aquamarine',
  },
  {
    id: 'andromeda',
    label: 'Andromeda',
    background: '#23262E',
    foreground: '#D5CED9',
    accent: '#00E8C6',
    category: 'Signature & Studio',
    description: 'Deep space carbon with glowing turquoise',
  },
  {
    id: 'moonlight',
    label: 'Moonlight',
    background: '#1E2030',
    foreground: '#C8D3F5',
    accent: '#82AAFF',
    category: 'Signature & Studio',
    description: 'Luminous midnight indigo and starlight blue',
  },
  {
    id: 'panda-syntax',
    label: 'Panda Syntax',
    background: '#292A2B',
    foreground: '#E6E6E6',
    accent: '#19F9D8',
    category: 'Signature & Studio',
    description: 'Warm studio charcoal with neon mint cyan',
  },
] as const;

export const DEFAULT_LIGHT_THEME_SETTINGS: ThemeVariantSettings<LightThemePresetId> = {
  preset: 'default-light',
  background: '#F9F9F9',
  foreground: '#101010',
  accent: '#007ACC',
};

export const DEFAULT_DARK_THEME_SETTINGS: ThemeVariantSettings<DarkThemePresetId> = {
  preset: 'default-dark',
  background: '#101010',
  foreground: '#CCCCCC',
  accent: '#007ACC',
};

export const DEFAULT_THEME_APPEARANCE_STATE: ThemeAppearanceState = {
  themeMode: 'dark',
  contrast: 'default',
  light: { ...DEFAULT_LIGHT_THEME_SETTINGS },
  dark: { ...DEFAULT_DARK_THEME_SETTINGS },
};

export function isValidHexColor(value: string): boolean {
  const cleaned = value.trim().replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(cleaned);
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback.toUpperCase();
  const cleaned = value.trim().replace(/^#/, '');
  if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
    return `#${cleaned.toUpperCase()}`;
  }
  if (/^[0-9A-Fa-f]{3}$/.test(cleaned)) {
    const expanded = cleaned
      .split('')
      .map((ch) => ch + ch)
      .join('');
    return `#${expanded.toUpperCase()}`;
  }
  return fallback.toUpperCase();
}

export function hexToRgbTuple(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex, '#000000').slice(1);
  const num = Number.parseInt(normalized, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function rgbTupleToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function mixHex(hexA: string, hexB: string, weightB: number): string {
  const w = Math.max(0, Math.min(1, weightB));
  const [r1, g1, b1] = hexToRgbTuple(hexA);
  const [r2, g2, b2] = hexToRgbTuple(hexB);
  return rgbTupleToHex(
    r1 * (1 - w) + r2 * w,
    g1 * (1 - w) + g2 * w,
    b1 * (1 - w) + b2 * w,
  );
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgbTuple(hex);
  const clamped = Math.max(0, Math.min(1, Number(alpha.toFixed(3))));
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

export function getLightThemePreset(idOrLabel: string): ThemePresetDefinition<LightThemePresetId> {
  return (
    LIGHT_THEME_PRESETS.find((preset) => preset.id === idOrLabel || preset.label === idOrLabel) ??
    LIGHT_THEME_PRESETS[0]
  );
}

export function getDarkThemePreset(idOrLabel: string): ThemePresetDefinition<DarkThemePresetId> {
  return (
    DARK_THEME_PRESETS.find((preset) => preset.id === idOrLabel || preset.label === idOrLabel) ??
    DARK_THEME_PRESETS[0]
  );
}

export const getLightPresetById = getLightThemePreset;
export const getDarkPresetById = getDarkThemePreset;

export function findMatchingLightPreset(palette: ThemeColorPalette): LightThemePresetId | 'Custom' {
  const bg = normalizeHexColor(palette.background, '');
  const fg = normalizeHexColor(palette.foreground, '');
  const accent = normalizeHexColor(palette.accent, '');
  const match = LIGHT_THEME_PRESETS.find(
    (p) =>
      p.background.toUpperCase() === bg &&
      p.foreground.toUpperCase() === fg &&
      p.accent.toUpperCase() === accent,
  );
  return match ? match.id : 'Custom';
}

export function findMatchingDarkPreset(palette: ThemeColorPalette): DarkThemePresetId | 'Custom' {
  const bg = normalizeHexColor(palette.background, '');
  const fg = normalizeHexColor(palette.foreground, '');
  const accent = normalizeHexColor(palette.accent, '');
  const match = DARK_THEME_PRESETS.find(
    (p) =>
      p.background.toUpperCase() === bg &&
      p.foreground.toUpperCase() === fg &&
      p.accent.toUpperCase() === accent,
  );
  return match ? match.id : 'Custom';
}

export function resolveSystemPrefersLight(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  } catch {
    return false;
  }
}

export function resolveEffectiveThemeMode(themeMode: ThemeMode): 'light' | 'dark' {
  if (themeMode === 'system') {
    return resolveSystemPrefersLight() ? 'light' : 'dark';
  }
  return themeMode;
}

const MANAGED_CSS_VARIABLES = [
  '--rtx-light-canvas',
  '--rtx-light-panel',
  '--rtx-light-panel-subtle',
  '--rtx-light-panel-header',
  '--rtx-light-elevated',
  '--rtx-light-chart',
  '--rtx-light-field',
  '--rtx-light-hover',
  '--rtx-light-pressed',
  '--rtx-light-selected',
  '--rtx-light-dock-selected',
  '--rtx-light-border',
  '--rtx-light-border-strong',
  '--rtx-light-control-border',
  '--rtx-light-control-border-hover',
  '--rtx-light-row-border',
  '--rtx-light-text',
  '--rtx-light-text-secondary',
  '--rtx-light-text-muted',
  '--rtx-light-text-disabled',
  '--rtx-light-price',
  '--rtx-light-accent',
  '--rtx-light-accent-strong',
  '--rtx-light-accent-pressed',
  '--rtx-light-accent-soft',
  '--rtx-light-accent-border',
  '--rtx-light-focus-ring',
  '--rtx-dark-bg-primary',
  '--rtx-dark-bg-secondary',
  '--rtx-dark-bg-tertiary',
  '--rtx-dark-bg-quaternary',
  '--rtx-dark-bg-elevated',
  '--rtx-dark-border-primary',
  '--rtx-dark-border-secondary',
  '--rtx-dark-border-tertiary',
  '--rtx-dark-toolbox-tabs',
  '--rtx-dark-toolbox-summary',
  '--rtx-dark-accent',
  '--rtx-theme-chart-bg',
  '--rtx-theme-chart-fg',
  '--rtx-theme-chart-grid',
  '--bg-primary',
  '--bg-secondary',
  '--bg-tertiary',
  '--bg-quaternary',
  '--bg-elevated',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--text-quaternary',
  '--border-primary',
  '--border-secondary',
  '--border-tertiary',
  '--color-primary',
  '--color-primary-hover',
  '--color-primary-active',
  '--color-primary-dim',
  '--color-primary-dimmer',
  '--color-info',
  '--color-info-dim',
  '--background',
  '--foreground',
  '--muted',
  '--muted-foreground',
  '--border',
  '--input',
  '--ring',
  '--primary',
  '--ctx-bg',
  '--ctx-border',
  '--ctx-hover',
  '--ctx-active-bg',
  '--ctx-item-active-bg',
  '--ctx-text',
  '--ctx-muted',
  '--ctx-header',
  '--ctx-blue',
  '--ctx-icon',
] as const;

export function deriveThemeCssVariables(
  mode: 'light' | 'dark',
  palette: ThemeColorPalette,
  contrast: ThemeContrast,
): Record<string, string> {
  const bg = normalizeHexColor(palette.background, mode === 'light' ? '#F9F9F9' : '#101010');
  const fg = normalizeHexColor(palette.foreground, mode === 'light' ? '#101010' : '#CCCCCC');
  const accent = normalizeHexColor(palette.accent, '#007ACC');
  const strong = contrast === 'strong';

  if (mode === 'light') {
    const canvas = mixHex(bg, fg, strong ? 0.11 : 0.06);
    const panel = bg;
    const panelSubtle = mixHex(bg, fg, strong ? 0.065 : 0.035);
    const panelHeader = mixHex(bg, fg, strong ? 0.12 : 0.075);
    const elevated = mixHex(bg, '#FFFFFF', 0.22);
    const chartBg = bg;
    const field = mixHex(bg, '#FFFFFF', 0.28);
    const hover = mixHex(bg, accent, strong ? 0.15 : 0.09);
    const pressed = mixHex(bg, accent, strong ? 0.22 : 0.15);
    const selected = mixHex(bg, accent, strong ? 0.20 : 0.13);
    const dockSelected = mixHex(bg, accent, strong ? 0.26 : 0.18);
    const border = mixHex(bg, fg, strong ? 0.30 : 0.17);
    const borderStrong = mixHex(bg, fg, strong ? 0.44 : 0.27);
    const controlBorder = mixHex(bg, fg, strong ? 0.58 : 0.42);
    const controlBorderHover = mixHex(bg, fg, strong ? 0.70 : 0.54);
    const rowBorder = mixHex(bg, fg, strong ? 0.20 : 0.11);
    const textPrimary = strong ? mixHex(fg, '#000000', 0.35) : fg;
    const textSecondary = mixHex(fg, bg, strong ? 0.12 : 0.22);
    const textMuted = mixHex(fg, bg, strong ? 0.24 : 0.36);
    const textDisabled = mixHex(fg, bg, 0.52);
    const priceText = mixHex(textPrimary, accent, 0.18);
    const accentStrong = mixHex(accent, '#000000', 0.18);
    const accentPressed = mixHex(accent, '#000000', 0.30);
    const accentSoft = mixHex(bg, accent, 0.14);

    return {
      '--rtx-light-canvas': canvas,
      '--rtx-light-panel': panel,
      '--rtx-light-panel-subtle': panelSubtle,
      '--rtx-light-panel-header': panelHeader,
      '--rtx-light-elevated': elevated,
      '--rtx-light-chart': chartBg,
      '--rtx-light-field': field,
      '--rtx-light-hover': hover,
      '--rtx-light-pressed': pressed,
      '--rtx-light-selected': selected,
      '--rtx-light-dock-selected': dockSelected,
      '--rtx-light-border': border,
      '--rtx-light-border-strong': borderStrong,
      '--rtx-light-control-border': controlBorder,
      '--rtx-light-control-border-hover': controlBorderHover,
      '--rtx-light-row-border': rowBorder,
      '--rtx-light-text': textPrimary,
      '--rtx-light-text-secondary': textSecondary,
      '--rtx-light-text-muted': textMuted,
      '--rtx-light-text-disabled': textDisabled,
      '--rtx-light-price': priceText,
      '--rtx-light-accent': accent,
      '--rtx-light-accent-strong': accentStrong,
      '--rtx-light-accent-pressed': accentPressed,
      '--rtx-light-accent-soft': accentSoft,
      '--rtx-light-accent-border': accent,
      '--rtx-light-focus-ring': withAlpha(accent, 0.20),
      '--rtx-theme-chart-bg': chartBg,
      '--rtx-theme-chart-fg': textSecondary,
      '--rtx-theme-chart-grid': withAlpha(fg, strong ? 0.12 : 0.07),
      '--bg-primary': canvas,
      '--bg-secondary': panel,
      '--bg-tertiary': panelSubtle,
      '--bg-quaternary': hover,
      '--bg-elevated': elevated,
      '--text-primary': textPrimary,
      '--text-secondary': textSecondary,
      '--text-tertiary': textMuted,
      '--text-quaternary': textDisabled,
      '--border-primary': border,
      '--border-secondary': borderStrong,
      '--border-tertiary': controlBorder,
      '--color-primary': accent,
      '--color-primary-hover': accentStrong,
      '--color-primary-active': accentPressed,
      '--color-primary-dim': withAlpha(accent, 0.15),
      '--color-primary-dimmer': withAlpha(accent, 0.08),
      '--color-info': accent,
      '--color-info-dim': withAlpha(accent, 0.12),
      '--background': canvas,
      '--foreground': textPrimary,
      '--muted': panelSubtle,
      '--muted-foreground': textMuted,
      '--border': border,
      '--input': field,
      '--ring': accent,
      '--primary': accent,
      '--ctx-bg': elevated,
      '--ctx-border': borderStrong,
      '--ctx-hover': hover,
      '--ctx-active-bg': accent,
      '--ctx-item-active-bg': accentSoft,
      '--ctx-text': textPrimary,
      '--ctx-muted': textMuted,
      '--ctx-header': textSecondary,
      '--ctx-blue': accent,
      '--ctx-icon': textMuted,
    };
  }

  const bgPrimary = mixHex(bg, '#000000', strong ? 0.32 : 0.20);
  const bgSecondary = bg;
  const bgTertiary = mixHex(bg, fg, strong ? 0.09 : 0.055);
  const bgQuaternary = mixHex(bg, fg, strong ? 0.16 : 0.105);
  const bgElevated = mixHex(bg, fg, strong ? 0.13 : 0.08);
  const borderPrimary = mixHex(bg, fg, strong ? 0.32 : 0.19);
  const borderSecondary = mixHex(bg, fg, strong ? 0.24 : 0.13);
  const borderTertiary = mixHex(bg, fg, strong ? 0.40 : 0.25);
  const textPrimary = strong ? mixHex(fg, '#FFFFFF', 0.38) : fg;
  const textSecondary = mixHex(fg, bg, strong ? 0.16 : 0.28);
  const textTertiary = mixHex(fg, bg, strong ? 0.32 : 0.45);
  const textQuaternary = mixHex(fg, bg, 0.60);
  const toolboxTabs = mixHex(bg, fg, strong ? 0.12 : 0.075);
  const toolboxSummary = mixHex(bg, fg, strong ? 0.18 : 0.125);
  const accentHover = mixHex(accent, '#FFFFFF', 0.15);
  const accentActive = mixHex(accent, '#000000', 0.15);

  return {
    '--rtx-dark-bg-primary': bgPrimary,
    '--rtx-dark-bg-secondary': bgSecondary,
    '--rtx-dark-bg-tertiary': bgTertiary,
    '--rtx-dark-bg-quaternary': bgQuaternary,
    '--rtx-dark-bg-elevated': bgElevated,
    '--rtx-dark-border-primary': borderPrimary,
    '--rtx-dark-border-secondary': borderSecondary,
    '--rtx-dark-border-tertiary': borderTertiary,
    '--rtx-dark-toolbox-tabs': toolboxTabs,
    '--rtx-dark-toolbox-summary': toolboxSummary,
    '--rtx-dark-accent': accent,
    '--rtx-theme-chart-bg': bgPrimary,
    '--rtx-theme-chart-fg': textPrimary,
    '--rtx-theme-chart-grid': withAlpha(fg, strong ? 0.16 : 0.10),
    '--bg-primary': bgPrimary,
    '--bg-secondary': bgSecondary,
    '--bg-tertiary': bgTertiary,
    '--bg-quaternary': bgQuaternary,
    '--bg-elevated': bgElevated,
    '--text-primary': textPrimary,
    '--text-secondary': textSecondary,
    '--text-tertiary': textTertiary,
    '--text-quaternary': textQuaternary,
    '--border-primary': borderPrimary,
    '--border-secondary': borderSecondary,
    '--border-tertiary': borderTertiary,
    '--color-primary': accent,
    '--color-primary-hover': accentHover,
    '--color-primary-active': accentActive,
    '--color-primary-dim': withAlpha(accent, 0.18),
    '--color-primary-dimmer': withAlpha(accent, 0.10),
    '--color-info': accent,
    '--color-info-dim': withAlpha(accent, 0.16),
    '--background': bgPrimary,
    '--foreground': textPrimary,
    '--muted': bgTertiary,
    '--muted-foreground': textSecondary,
    '--border': borderPrimary,
    '--input': bgTertiary,
    '--ring': accent,
    '--primary': accent,
    '--ctx-bg': bgElevated,
    '--ctx-border': borderPrimary,
    '--ctx-hover': bgQuaternary,
    '--ctx-active-bg': accent,
    '--ctx-item-active-bg': withAlpha(accent, 0.22),
    '--ctx-text': textPrimary,
    '--ctx-muted': textSecondary,
    '--ctx-header': textSecondary,
    '--ctx-blue': accent,
    '--ctx-icon': textSecondary,
  };
}

export function clearThemeAppearanceFromRoot(root: HTMLElement = document.documentElement): void {
  for (const prop of MANAGED_CSS_VARIABLES) {
    root.style.removeProperty(prop);
  }
  root.removeAttribute('data-rtx-theme-preset');
  root.removeAttribute('data-rtx-theme-contrast');
  root.removeAttribute('data-rtx-contrast');
  root.removeAttribute('data-rtx-theme-mode');
  root.removeAttribute('data-rtx-theme-configured');
}

export function applyThemeAppearanceToRoot(
  root: HTMLElement,
  state: ThemeAppearanceState,
  effectiveModeOverride?: 'light' | 'dark',
): void {
  const effectiveMode = effectiveModeOverride ?? resolveEffectiveThemeMode(state.themeMode);
  const variant = effectiveMode === 'light' ? state.light : state.dark;
  const matchedPreset = effectiveMode === 'light'
    ? findMatchingLightPreset(variant)
    : findMatchingDarkPreset(variant);
  const effectivePresetAttr = matchedPreset === 'Custom' ? 'custom' : matchedPreset;
  const isDefaultMainTheme =
    state.contrast === 'default' &&
    ((effectiveMode === 'light' && effectivePresetAttr === 'default-light') ||
      (effectiveMode === 'dark' && effectivePresetAttr === 'default-dark'));

  for (const prop of MANAGED_CSS_VARIABLES) {
    root.style.removeProperty(prop);
  }
  if (!isDefaultMainTheme) {
    const variables = deriveThemeCssVariables(effectiveMode, variant, state.contrast);
    for (const [prop, value] of Object.entries(variables)) {
      root.style.setProperty(prop, value);
    }
  }
  root.setAttribute('data-rtx-theme-preset', effectivePresetAttr);
  root.setAttribute('data-rtx-theme-contrast', state.contrast);
  root.setAttribute('data-rtx-contrast', state.contrast);
  root.setAttribute('data-rtx-theme-mode', state.themeMode);
  root.setAttribute('data-rtx-theme-configured', 'true');
}

export function loadStoredThemeAppearance(): ThemeAppearanceState {
  let fallbackThemeMode: ThemeMode = 'dark';
  try {
    const savedLight =
      localStorage.getItem('rtx5-advanced-view-enabled') === 'true' ||
      localStorage.getItem('rtx5-theme') === 'light';
    fallbackThemeMode = savedLight ? 'light' : 'dark';
  } catch {
    fallbackThemeMode = 'dark';
  }

  try {
    const raw = localStorage.getItem(RTX_THEME_APPEARANCE_STORAGE_KEY);
    if (!raw) {
      return {
        ...DEFAULT_THEME_APPEARANCE_STATE,
        themeMode: fallbackThemeMode,
        light: { ...DEFAULT_LIGHT_THEME_SETTINGS },
        dark: { ...DEFAULT_DARK_THEME_SETTINGS },
      };
    }
    const parsed = JSON.parse(raw) as Partial<ThemeAppearanceState> | null;
    const rawState = (parsed && typeof parsed === 'object' && 'state' in parsed
      ? (parsed as { state?: Partial<ThemeAppearanceState> }).state
      : parsed) ?? {};

    const validThemeMode: ThemeMode =
      rawState.themeMode === 'system' || rawState.themeMode === 'light' || rawState.themeMode === 'dark'
        ? rawState.themeMode
        : fallbackThemeMode;
    const validContrast: ThemeContrast =
      rawState.contrast === 'strong' || rawState.contrast === 'default'
        ? rawState.contrast
        : 'default';

    const matchedLightPreset = LIGHT_THEME_PRESETS.find(
      (p) => p.id === rawState.light?.preset || p.label === rawState.light?.preset,
    );
    const lightPreset = matchedLightPreset ? matchedLightPreset.id : DEFAULT_LIGHT_THEME_SETTINGS.preset;
    const lightPresetDefaults = getLightThemePreset(lightPreset);

    const matchedDarkPreset = DARK_THEME_PRESETS.find(
      (p) => p.id === rawState.dark?.preset || p.label === rawState.dark?.preset,
    );
    const darkPreset = matchedDarkPreset ? matchedDarkPreset.id : DEFAULT_DARK_THEME_SETTINGS.preset;
    const darkPresetDefaults = getDarkThemePreset(darkPreset);

    return {
      themeMode: validThemeMode,
      contrast: validContrast,
      light: {
        preset: lightPreset,
        background: normalizeHexColor(rawState.light?.background, lightPresetDefaults.background),
        foreground: normalizeHexColor(rawState.light?.foreground, lightPresetDefaults.foreground),
        accent: normalizeHexColor(rawState.light?.accent, lightPresetDefaults.accent),
      },
      dark: {
        preset: darkPreset,
        background: normalizeHexColor(rawState.dark?.background, darkPresetDefaults.background),
        foreground: normalizeHexColor(rawState.dark?.foreground, darkPresetDefaults.foreground),
        accent: normalizeHexColor(rawState.dark?.accent, darkPresetDefaults.accent),
      },
    };
  } catch {
    return {
      ...DEFAULT_THEME_APPEARANCE_STATE,
      themeMode: fallbackThemeMode,
      light: { ...DEFAULT_LIGHT_THEME_SETTINGS },
      dark: { ...DEFAULT_DARK_THEME_SETTINGS },
    };
  }
}
