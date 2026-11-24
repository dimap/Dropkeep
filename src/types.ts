export type BookmarkType = 'link' | 'article' | 'image' | 'video' | 'document';
export type HighlightColor = 'yellow' | 'blue' | 'pink' | 'green';
export type ViewMode = 'list' | 'grid' | 'headlines' | 'masonry';
export type SortMode = 'newest' | 'oldest' | 'title_asc' | 'title_desc' | 'domain';

export interface DisplayFields {
  cover: boolean;
  title: boolean;
  note: boolean;
  excerpt: boolean;
  highlights: boolean;
  tags: boolean;
  info: boolean;
}

export type NavScope = 'all' | 'unsorted' | 'favorites' | 'trash' | 'collection';
export type SmartFilter =
  | ''
  | 'article'
  | 'video'
  | 'image'
  | 'link'
  | 'document'
  | 'highlights'
  | 'offline'
  | 'untagged'
  | 'duplicates';

export interface Collection {
  id: string;
  title: string;
  parent_id: string | null;
  icon: string;
  color: string;
  sort_order: number;
  created_at: string;
  count: number;
}

export interface Highlight {
  id: string;
  bookmark_id: string;
  text: string;
  note: string;
  color: HighlightColor;
  created_at: string;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  note: string;
  cover: string;
  favicon: string;
  domain: string;
  type: BookmarkType;
  collection_id: string | null;
  is_favorite: boolean;
  is_trashed: boolean;
  reader_content: string;
  ai_summary: string;
  snapshot_size: number;
  snapshot_created_at: string | null;
  created_at: string;
  updated_at: string;
  tags: string[];
  highlights: Highlight[];
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface SmartStats {
  all: number;
  unsorted: number;
  favorites: number;
  trash: number;
  articles: number;
  videos: number;
  images: number;
  links: number;
  documents: number;
  highlights: number;
  untagged: number;
  duplicates: number;
  offline: number;
  dbSizeBytes: number;
  snapshotsSizeBytes: number;
  pdfEngine?: 'chromium' | 'builtin';
  dbPath: string;
}

export interface WorkspaceData {
  collections: Collection[];
  tags: TagCount[];
  stats: SmartStats;
  aiConfigured: boolean;
}

export interface ScrapedMetadata {
  url: string;
  title: string;
  excerpt: string;
  cover: string;
  favicon: string;
  domain: string;
  type: BookmarkType;
  reader_content: string;
}

export interface AuthStatus {
  authEnabled: boolean;
  authenticated: boolean;
  source: 'env' | 'db' | 'none';
}

export interface AiStatus {
  configured: boolean;
  endpointHost: string;
  model: string;
  hasApiKey: boolean;
}

export interface AiTagSuggestion {
  tags: string[];
  existingMatches: string[];
  newTags: string[];
  model: string;
  metadata?: ScrapedMetadata | null;
}

export interface AiSuggestResult extends AiTagSuggestion {
  excerpt: string | null;
  collection_id: string | null;
  collection_title: string | null;
}

export interface AiSummaryData {
  tldr: string;
  bullets: string[];
  model?: string;
  created_at?: string;
}

export interface AiSmartSearchResult {
  bookmarks: Bookmark[];
  reasons: Record<string, string>;
  model: string;
  scannedCount: number;
}
