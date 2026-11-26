import type {
  AppPreferences,
  AppTheme,
  BookmarkClickAction,
  CardButtonId,
  FallbackCoverStyle,
  TagSortMode,
  ViewMode,
} from '../types';

const PREFERENCES_STORAGE_KEY = 'dropkeep_preferences';

const VALID_THEMES: AppTheme[] = ['light', 'dark', 'dark-sidebar', 'sepia'];
const VALID_COVER_STYLES: FallbackCoverStyle[] = ['minimal', 'soft-tint', 'monochrome', 'paper', 'dots'];
const VALID_VIEW_MODES: ViewMode[] = ['list', 'grid', 'headlines', 'masonry'];
const VALID_CLICK_ACTIONS: BookmarkClickAction[] = ['new_tab', 'same_tab', 'inspector'];
const VALID_TAG_SORTS: TagSortMode[] = ['name', 'count'];
export const ALL_CARD_BUTTONS: CardButtonId[] = ['edit', 'open', 'copy', 'pdf', 'favorite', 'trash'];

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: 'light',
  fallbackCoverStyle: 'minimal',
  largeFont: false,
  defaultViewMode: 'grid',
  clickAction: 'new_tab',
  cardButtons: ['edit', 'open', 'copy', 'pdf', 'trash'],
  showTypeBadge: true,
  tagSort: 'count',
  includeNested: true,
  confirmPermanentDelete: true,
};

function detectDefaultTheme(): AppTheme {
  if (typeof window === 'undefined') return 'light';
  try {
    const legacy = window.localStorage.getItem('dropkeep_theme');
    if (legacy === 'dark' || legacy === 'light') return legacy;
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch {
    // ignore storage errors
  }
  return 'light';
}

function detectLegacyViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'grid';
  try {
    const legacy = window.localStorage.getItem('dropkeep_view') as ViewMode | null;
    if (legacy && VALID_VIEW_MODES.includes(legacy)) return legacy;
  } catch {
    // ignore storage errors
  }
  return 'grid';
}

export function loadPreferences(): AppPreferences {
  const fallbackTheme = detectDefaultTheme();
  const fallbackView = detectLegacyViewMode();
  const base: AppPreferences = {
    ...DEFAULT_PREFERENCES,
    theme: fallbackTheme,
    defaultViewMode: fallbackView,
  };

  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<AppPreferences>;
    if (!parsed || typeof parsed !== 'object') return base;

    const cardButtons = Array.isArray(parsed.cardButtons)
      ? parsed.cardButtons.filter((btn): btn is CardButtonId =>
          ALL_CARD_BUTTONS.includes(btn as CardButtonId)
        )
      : base.cardButtons;

    return {
      theme: parsed.theme && VALID_THEMES.includes(parsed.theme) ? parsed.theme : base.theme,
      fallbackCoverStyle:
        parsed.fallbackCoverStyle && VALID_COVER_STYLES.includes(parsed.fallbackCoverStyle)
          ? parsed.fallbackCoverStyle
          : base.fallbackCoverStyle,
      largeFont: typeof parsed.largeFont === 'boolean' ? parsed.largeFont : base.largeFont,
      defaultViewMode:
        parsed.defaultViewMode && VALID_VIEW_MODES.includes(parsed.defaultViewMode)
          ? parsed.defaultViewMode
          : base.defaultViewMode,
      clickAction:
        parsed.clickAction && VALID_CLICK_ACTIONS.includes(parsed.clickAction)
          ? parsed.clickAction
          : base.clickAction,
      cardButtons,
      showTypeBadge:
        typeof parsed.showTypeBadge === 'boolean' ? parsed.showTypeBadge : base.showTypeBadge,
      tagSort:
        parsed.tagSort && VALID_TAG_SORTS.includes(parsed.tagSort)
          ? parsed.tagSort
          : base.tagSort,
      includeNested:
        typeof parsed.includeNested === 'boolean' ? parsed.includeNested : base.includeNested,
      confirmPermanentDelete:
        typeof parsed.confirmPermanentDelete === 'boolean'
          ? parsed.confirmPermanentDelete
          : base.confirmPermanentDelete,
    };
  } catch {
    return base;
  }
}

export function savePreferences(prefs: AppPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
    // Keep legacy theme key synced for clean fallback compatibility
    window.localStorage.setItem('dropkeep_theme', prefs.theme === 'dark' ? 'dark' : 'light');
  } catch {
    // ignore storage errors
  }
}
