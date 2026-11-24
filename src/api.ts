import type {
  AiSmartSearchResult,
  AiStatus,
  AiSuggestResult,
  AiSummaryData,
  AiTagSuggestion,
  AuthStatus,
  Bookmark,
  BookmarkType,
  Collection,
  Highlight,
  HighlightColor,
  ScrapedMetadata,
  SortMode,
  WorkspaceData,
} from './types';

// Keep session token strictly in memory (never in localStorage/sessionStorage)
let authToken = '';

export function setAuthToken(token: string): void {
  authToken = token;
}

export function getAuthToken(): string {
  return authToken;
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Requested-With', 'dropkeep');
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const res = await fetch(url, { ...options, headers, credentials: 'include' });
  if (!res.ok) {
    let message = `Ошибка запроса (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // keep default message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  return (await res.json()) as T;
}

export const api = {
  // Auth
  getAuthStatus: () => apiFetch<AuthStatus>('/api/auth/status'),
  login: (password: string) =>
    apiFetch<{ token: string; authEnabled: boolean }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () =>
    apiFetch<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
    }),
  updatePassword: (payload: { action: 'set' | 'disable'; password?: string }) =>
    apiFetch<{ authEnabled: boolean; source: 'db' | 'none'; token?: string }>('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Workspace
  getWorkspace: () => apiFetch<WorkspaceData>('/api/workspace'),

  // Collections
  createCollection: (payload: {
    title: string;
    parent_id?: string | null;
    icon?: string;
    color?: string;
  }) =>
    apiFetch<Collection>('/api/collections', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCollection: (
    id: string,
    payload: { title?: string; parent_id?: string | null; icon?: string; color?: string }
  ) =>
    apiFetch<Collection>(`/api/collections/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteCollection: (id: string) =>
    apiFetch<{ deleted: boolean }>(`/api/collections/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Bookmarks
  listBookmarks: (params: {
    scope: string;
    collectionId?: string;
    filterType?: string;
    tag?: string;
    search?: string;
    sort: SortMode;
    includeNested?: boolean;
  }) => {
    const qs = new URLSearchParams();
    qs.set('scope', params.scope);
    if (params.collectionId) qs.set('collectionId', params.collectionId);
    if (params.filterType) qs.set('filterType', params.filterType);
    if (params.tag) qs.set('tag', params.tag);
    if (params.search) qs.set('search', params.search);
    qs.set('sort', params.sort);
    if (params.includeNested === false) qs.set('includeNested', 'false');
    return apiFetch<Bookmark[]>(`/api/bookmarks?${qs.toString()}`);
  },
  getBookmark: (id: string) => apiFetch<Bookmark>(`/api/bookmarks/${encodeURIComponent(id)}`),
  createBookmark: (payload: {
    url: string;
    title?: string;
    excerpt?: string;
    note?: string;
    cover?: string;
    favicon?: string;
    type?: BookmarkType;
    collection_id?: string | null;
    is_favorite?: boolean;
    reader_content?: string;
    tags?: string[];
    save_offline_pdf?: boolean;
  }) =>
    apiFetch<Bookmark>('/api/bookmarks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateBookmark: (
    id: string,
    payload: Partial<{
      url: string;
      title: string;
      excerpt: string;
      note: string;
      cover: string;
      favicon: string;
      type: BookmarkType;
      collection_id: string | null;
      is_favorite: boolean;
      is_trashed: boolean;
      reader_content: string;
      tags: string[];
    }>
  ) =>
    apiFetch<Bookmark>(`/api/bookmarks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  refreshBookmark: (id: string) =>
    apiFetch<Bookmark>(`/api/bookmarks/${encodeURIComponent(id)}/refresh`, {
      method: 'POST',
    }),
  createPdfSnapshot: (id: string) =>
    apiFetch<Bookmark>(`/api/bookmarks/${encodeURIComponent(id)}/snapshot`, {
      method: 'POST',
    }),
  deletePdfSnapshot: (id: string) =>
    apiFetch<Bookmark>(`/api/bookmarks/${encodeURIComponent(id)}/snapshot`, {
      method: 'DELETE',
    }),
  fetchPdfSnapshotBuffer: async (id: string): Promise<ArrayBuffer> => {
    const headers = new Headers({ 'X-Requested-With': 'dropkeep' });
    if (authToken) {
      headers.set('Authorization', `Bearer ${authToken}`);
    }
    const res = await fetch(`/api/bookmarks/${encodeURIComponent(id)}/snapshot`, {
      headers,
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error('Не удалось загрузить PDF-снимок');
    }
    return await res.arrayBuffer();
  },
  downloadPdfSnapshot: async (id: string, title: string): Promise<void> => {
    const headers = new Headers({ 'X-Requested-With': 'dropkeep' });
    if (authToken) {
      headers.set('Authorization', `Bearer ${authToken}`);
    }
    const res = await fetch(`/api/bookmarks/${encodeURIComponent(id)}/snapshot?download=1`, {
      headers,
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error('Не удалось скачать PDF-снимок');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName =
      title
        .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
        .trim()
        .slice(0, 80) || 'dropkeep-offline';
    a.download = `${safeName}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  deleteBookmark: (id: string, permanent = false) =>
    apiFetch<{ deleted?: boolean }>(`/api/bookmarks/${encodeURIComponent(id)}${permanent ? '?permanent=true' : ''}`, {
      method: 'DELETE',
    }),
  bulkBookmarks: (payload: {
    ids: string[];
    action: 'move' | 'add_tag' | 'favorite' | 'unfavorite' | 'trash' | 'restore' | 'delete';
    collection_id?: string | null;
    tag?: string;
  }) =>
    apiFetch<{ affected: number }>('/api/bookmarks/bulk', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  emptyTrash: () => apiFetch<{ removed: number }>('/api/trash/empty', { method: 'POST' }),

  // Highlights
  addHighlight: (
    bookmarkId: string,
    payload: { text: string; note?: string; color?: HighlightColor }
  ) =>
    apiFetch<Highlight>(`/api/bookmarks/${encodeURIComponent(bookmarkId)}/highlights`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteHighlight: (highlightId: string) =>
    apiFetch<{ deleted: boolean }>(`/api/highlights/${encodeURIComponent(highlightId)}`, {
      method: 'DELETE',
    }),

  // Tags
  renameTag: (oldTag: string, newTag: string) =>
    apiFetch<{ updated: number }>(`/api/tags/${encodeURIComponent(oldTag)}`, {
      method: 'PATCH',
      body: JSON.stringify({ newTag }),
    }),
  deleteTag: (tag: string) =>
    apiFetch<{ removed: number }>(`/api/tags/${encodeURIComponent(tag)}`, {
      method: 'DELETE',
    }),

  // Scraper
  fetchMetadata: (url: string) =>
    apiFetch<ScrapedMetadata>('/api/metadata/fetch', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),

  // AI Enrichment & Tagging
  getAiStatus: () => apiFetch<AiStatus>('/api/ai/status'),
  testAiConnection: () =>
    apiFetch<{ ok: boolean; model: string; latencyMs: number }>('/api/ai/test', {
      method: 'POST',
    }),
  suggestBookmark: (payload: {
    url?: string;
    title?: string;
    excerpt?: string;
    reader_content?: string;
    fields?: { tags?: boolean; collection?: boolean; excerpt?: boolean };
  }) =>
    apiFetch<AiSuggestResult>('/api/ai/suggest', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  suggestTags: (payload: {
    url?: string;
    title?: string;
    excerpt?: string;
    reader_content?: string;
  }) =>
    apiFetch<AiTagSuggestion>('/api/ai/suggest-tags', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  smartSearch: (payload: {
    query: string;
    scope: string;
    collectionId?: string;
    filterType?: string;
    tag?: string;
  }) =>
    apiFetch<AiSmartSearchResult>('/api/ai/search', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  generateBookmarkSummary: (id: string) =>
    apiFetch<{ bookmark: Bookmark; summary: AiSummaryData }>(
      `/api/bookmarks/${encodeURIComponent(id)}/summary`,
      { method: 'POST' }
    ),
  deleteBookmarkSummary: (id: string) =>
    apiFetch<Bookmark>(`/api/bookmarks/${encodeURIComponent(id)}/summary`, {
      method: 'DELETE',
    }),

  // Import & Export
  importBookmarks: (format: 'html' | 'json' | 'csv', content: string) =>
    apiFetch<{ imported: number }>('/api/import', {
      method: 'POST',
      body: JSON.stringify({ format, content }),
    }),

  downloadExport: async (format: 'html' | 'json' | 'csv') => {
    const headers = new Headers({ 'X-Requested-With': 'dropkeep' });
    if (authToken) {
      headers.set('Authorization', `Bearer ${authToken}`);
    }
    const res = await fetch(`/api/export?format=${format}`, {
      headers,
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Не удалось выполнить экспорт');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      format === 'json'
        ? 'dropkeep-backup.json'
        : format === 'csv'
          ? 'dropkeep-bookmarks.csv'
          : 'dropkeep-bookmarks.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
