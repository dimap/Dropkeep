export type BookmarkType = 'link' | 'article' | 'image' | 'video' | 'document' | 'note' | 'todo';
export type HighlightColor = 'yellow' | 'blue' | 'pink' | 'green';
export type CardColor = '' | 'amber' | 'sage' | 'sky' | 'lavender' | 'rose' | 'sand' | 'slate';
export type TodoPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TodoItem {
  id: string;
  text: string;
  progress: number;
  priority: TodoPriority;
}

export interface CollectionRecord {
  id: string;
  title: string;
  parent_id: string | null;
  icon: string;
  color: string;
  sort_order: number;
  created_at: string;
  count?: number;
}

export interface HighlightRecord {
  id: string;
  bookmark_id: string;
  text: string;
  note: string;
  color: HighlightColor;
  created_at: string;
}

export interface BookmarkRecord {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  note: string;
  cover: string;
  favicon: string;
  domain: string;
  type: BookmarkType;
  card_color: CardColor;
  todo_items: TodoItem[];
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
  highlights: HighlightRecord[];
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

export interface ArticleBlock {
  kind: 'h1' | 'h2' | 'h3' | 'p' | 'quote' | 'li' | 'code';
  text: string;
}

export interface ScrapedArticle {
  title: string;
  excerpt: string;
  author: string;
  blocks: ArticleBlock[];
  reader_content: string;
}
