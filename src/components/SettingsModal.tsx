import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronRight,
  Container,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileDown,
  GripVertical,
  LayoutGrid,
  LayoutList,
  Loader2,
  Lock,
  LogOut,
  Pencil,
  Rows3,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import { api, setAuthToken } from '../api';
import type {
  AiStatus,
  AppPreferences,
  AppTheme,
  AuthStatus,
  BookmarkClickAction,
  CardButtonId,
  FallbackCoverStyle,
  SmartStats,
  ViewMode,
} from '../types';
import { formatBytes } from '../utils/icons';

function getDefaultAppBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  const path = window.location.pathname.replace(/\/+$/, '');
  return `${window.location.origin}${path}`;
}

function normalizeAppBaseUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const cleanPath = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${cleanPath}`;
  } catch {
    return null;
  }
}

function buildBookmarkletCode(baseUrl: string): string {
  const target = JSON.stringify(`${baseUrl}/`);
  return `javascript:(function(){var u=location.href,t=document.title||'',s='';try{s=(window.getSelection?window.getSelection().toString():'').trim().slice(0,500);}catch(e){}if(!s){var m=document.querySelector('meta[name="description"],meta[property="og:description"]');if(m&&m.content)s=m.content.trim().slice(0,500);}var p='?add=1&url='+encodeURIComponent(u)+'&title='+encodeURIComponent(t)+(s?'&excerpt='+encodeURIComponent(s):'');var w=window.open(${target}+p,'_blank');if(!w)location.href=${target}+p;})();`;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

interface SettingsModalProps {
  stats: SmartStats;
  authStatus: AuthStatus;
  preferences: AppPreferences;
  onUpdatePreferences: (patch: Partial<AppPreferences>) => void;
  onClose: () => void;
  onDataChanged: () => void;
  onAuthChanged: (status: AuthStatus) => void;
}

const DOCKER_COMPOSE_SNIPPET = `services:
  dropkeep:
    image: ghcr.io/dimap/dropkeep:latest
    container_name: dropkeep
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATA_DIR=/data
      # Для полных визуальных PDF-снимков и скриншотов обложек (удалите, если не нужен Gotenberg):
      - GOTENBERG_URL=http://gotenberg:3000
      # Своя OpenAI-совместимая ИИ-модель (OpenAI / OpenRouter / Ollama / vLLM):
      - AI_API_URL=\${AI_API_URL:-}
      - AI_API_KEY=\${AI_API_KEY:-}
      - AI_MODEL=\${AI_MODEL:-}
      # Раскомментируйте для защиты паролем:
      # - APP_PASSWORD=your-strong-password
    volumes:
      - dropkeep_data:/data

  # Chromium-рендерер для полных PDF-снимков и скриншотов обложек (можно убрать, если не нужен):
  gotenberg:
    image: gotenberg/gotenberg:8
    container_name: dropkeep-gotenberg
    restart: unless-stopped

volumes:
  dropkeep_data:`;

const AI_ENV_SNIPPET = `# OpenAI / OpenRouter / DeepSeek / LiteLLM:
AI_API_URL=https://openrouter.ai/api/v1
AI_API_KEY=your-api-key
AI_MODEL=openai/gpt-4o-mini

# Или локальная Ollama на вашем сервере (API-ключ не обязателен):
# AI_API_URL=http://host.docker.internal:11434/v1
# AI_API_KEY=
# AI_MODEL=qwen2.5:7b`;

const THEME_OPTIONS: Array<{
  id: AppTheme;
  label: string;
  sidebarBg: string;
  sidebarLine: string;
  mainBg: string;
  cardBg: string;
}> = [
  {
    id: 'light',
    label: 'Светлая',
    sidebarBg: '#F1F3F6',
    sidebarLine: '#C5CCD6',
    mainBg: '#FFFFFF',
    cardBg: '#E6E9EF',
  },
  {
    id: 'dark',
    label: 'Тёмная',
    sidebarBg: '#1E2024',
    sidebarLine: '#484D57',
    mainBg: '#2A2C32',
    cardBg: '#3D414A',
  },
  {
    id: 'dark-sidebar',
    label: 'Тёмная панель',
    sidebarBg: '#1E2024',
    sidebarLine: '#4F5561',
    mainBg: '#FFFFFF',
    cardBg: '#E4E7EE',
  },
  {
    id: 'sepia',
    label: 'Сепия',
    sidebarBg: '#EFE5CE',
    sidebarLine: '#C2B496',
    mainBg: '#FAF5E8',
    cardBg: '#E6DAC0',
  },
];

const FALLBACK_COVER_OPTIONS: Array<{
  id: FallbackCoverStyle;
  label: string;
  description: string;
}> = [
  { id: 'minimal', label: 'Спокойный', description: 'Ровный нейтральный фон без узора' },
  { id: 'soft-tint', label: 'Оттенок', description: 'Мягкий пастельный тон по сайту' },
  { id: 'monochrome', label: 'Монохром', description: 'Буква домена на сдержанном фоне' },
  { id: 'paper', label: 'Тёплый', description: 'Кремовая бумага для глаз' },
  { id: 'dots', label: 'Точки', description: 'Деликатная еле заметная сетка' },
];

const CARD_BUTTON_OPTIONS: Array<{
  id: CardButtonId;
  label: string;
  icon: typeof Pencil;
}> = [
  { id: 'edit', label: 'Редактировать', icon: Pencil },
  { id: 'open', label: 'Открыть сайт', icon: ExternalLink },
  { id: 'copy', label: 'Копировать ссылку', icon: Copy },
  { id: 'pdf', label: 'Офлайн PDF', icon: FileDown },
  { id: 'favorite', label: 'Избранное', icon: Star },
  { id: 'trash', label: 'В корзину', icon: Trash2 },
];

const VIEW_MODE_OPTIONS: Array<{ id: ViewMode; label: string; icon: typeof LayoutGrid }> = [
  { id: 'grid', label: 'Карточки', icon: LayoutGrid },
  { id: 'masonry', label: 'Плитка', icon: LayoutGrid },
  { id: 'list', label: 'Список', icon: LayoutList },
  { id: 'headlines', label: 'Заголовки', icon: Rows3 },
];

const CLICK_ACTION_OPTIONS: Array<{ id: BookmarkClickAction; label: string }> = [
  { id: 'new_tab', label: 'Открыть в новой вкладке' },
  { id: 'same_tab', label: 'Открыть в текущей вкладке' },
  { id: 'inspector', label: 'Открыть предпросмотр' },
];

export function SettingsModal({
  stats,
  authStatus,
  preferences,
  onUpdatePreferences,
  onClose,
  onDataChanged,
  onAuthChanged,
}: SettingsModalProps) {
  const [tab, setTab] = useState<'app' | 'data' | 'tools' | 'security'>('app');

  // Data tab state
  const [importStatus, setImportStatus] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [deleteAllConfirming, setDeleteAllConfirming] = useState(false);
  const [deleteCollectionsToo, setDeleteCollectionsToo] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteAllStatus, setDeleteAllStatus] = useState('');
  const [deleteAllError, setDeleteAllError] = useState('');

  // Tools tab state
  const [copiedCompose, setCopiedCompose] = useState(false);
  const [copiedAiEnv, setCopiedAiEnv] = useState(false);
  const [showAiEnv, setShowAiEnv] = useState(false);
  const [showDockerCompose, setShowDockerCompose] = useState(false);
  const [bookmarkletBaseUrl, setBookmarkletBaseUrl] = useState<string>(() => getDefaultAppBaseUrl());
  const [copiedBookmarklet, setCopiedBookmarklet] = useState(false);
  const [bookmarkletClickHint, setBookmarkletClickHint] = useState(false);
  const bookmarkletLinkRef = useRef<HTMLAnchorElement | null>(null);

  const normalizedBookmarkletBase = useMemo(
    () => normalizeAppBaseUrl(bookmarkletBaseUrl),
    [bookmarkletBaseUrl]
  );
  const bookmarkletCode = useMemo(
    () => buildBookmarkletCode(normalizedBookmarkletBase || getDefaultAppBaseUrl()),
    [normalizedBookmarkletBase]
  );

  useEffect(() => {
    const el = bookmarkletLinkRef.current;
    if (!el) return;
    el.setAttribute('href', bookmarkletCode);
  }, [tab, bookmarkletCode]);

  const handleDownloadBookmarkletHtml = () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Dropkeep Bookmarklet</TITLE>
<H1>Dropkeep</H1>
<DL><p>
    <DT><A HREF="${escapeHtmlAttr(bookmarkletCode)}" ADD_DATE="${nowSec}">+ Сохранить в Dropkeep</A>
</DL><p>
`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = 'dropkeep-bookmarklet.html';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  };

  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestMsg, setAiTestMsg] = useState('');
  const [aiTestError, setAiTestError] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [secMessage, setSecMessage] = useState('');
  const [secError, setSecError] = useState('');
  const [secLoading, setSecLoading] = useState(false);

  useEffect(() => {
    api
      .getAiStatus()
      .then(setAiStatus)
      .catch(() => {
        setAiStatus({ configured: false, endpointHost: '', model: '', hasApiKey: false });
      });
  }, []);

  const handleToggleCardButton = (id: CardButtonId) => {
    const exists = preferences.cardButtons.includes(id);
    const next = exists
      ? preferences.cardButtons.filter((item) => item !== id)
      : [...preferences.cardButtons, id];
    onUpdatePreferences({ cardButtons: next });
  };

  const handleTestAi = async () => {
    setAiTesting(true);
    setAiTestMsg('');
    setAiTestError('');
    try {
      const res = await api.testAiConnection();
      setAiTestMsg(`Подключение успешно: ${res.model} (${res.latencyMs} мс)`);
    } catch (err) {
      setAiTestError(err instanceof Error ? err.message : 'Ошибка проверки подключения');
    } finally {
      setAiTesting(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    setImporting(true);
    setImportError('');
    setImportStatus('');
    try {
      const content = await file.text();
      const lower = file.name.toLowerCase();
      const format: 'html' | 'json' | 'csv' = lower.endsWith('.json')
        ? 'json'
        : lower.endsWith('.csv')
          ? 'csv'
          : 'html';
      const result = await api.importBookmarks(format, content);
      setImportStatus(`Успешно импортировано закладок: ${result.imported}`);
      onDataChanged();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Не удалось импортировать файл');
    } finally {
      setImporting(false);
    }
  };

  const handleDeleteAllBookmarks = async () => {
    setDeletingAll(true);
    setDeleteAllError('');
    setDeleteAllStatus('');
    try {
      const res = await api.deleteAllBookmarks(deleteCollectionsToo);
      setDeleteAllConfirming(false);
      setDeleteCollectionsToo(false);
      const colSuffix =
        res.removedCollections > 0 ? ` и коллекций: ${res.removedCollections}` : '';
      setDeleteAllStatus(`Удалено закладок: ${res.removedBookmarks}${colSuffix}.`);
      onDataChanged();
    } catch (err) {
      setDeleteAllError(err instanceof Error ? err.message : 'Не удалось удалить закладки');
    } finally {
      setDeletingAll(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecLoading(true);
    setSecError('');
    setSecMessage('');
    try {
      const res = await api.updatePassword({ action: 'set', password: newPassword });
      if (res.token) setAuthToken(res.token);
      onAuthChanged({ authEnabled: true, authenticated: true, source: 'db' });
      setNewPassword('');
      setSecMessage('Мастер-пароль установлен. Хэш сохранён в SQLite с использованием scrypt.');
    } catch (err) {
      setSecError(err instanceof Error ? err.message : 'Ошибка установки пароля');
    } finally {
      setSecLoading(false);
    }
  };

  const handleDisablePassword = async () => {
    setSecLoading(true);
    setSecError('');
    setSecMessage('');
    try {
      await api.updatePassword({ action: 'disable' });
      setAuthToken('');
      onAuthChanged({ authEnabled: false, authenticated: true, source: 'none' });
      setSecMessage('Защита паролем отключена.');
    } catch (err) {
      setSecError(err instanceof Error ? err.message : 'Ошибка отключения пароля');
    } finally {
      setSecLoading(false);
    }
  };

  const handleLogout = async () => {
    setSecLoading(true);
    setSecError('');
    setSecMessage('');
    try {
      await api.logout();
      setAuthToken('');
      onAuthChanged({ ...authStatus, authenticated: false });
      onClose();
    } catch (err) {
      setSecError(err instanceof Error ? err.message : 'Не удалось завершить сессию');
    } finally {
      setSecLoading(false);
    }
  };

  const tabs = [
    { id: 'app' as const, label: 'Приложение', icon: SlidersHorizontal },
    { id: 'data' as const, label: 'Данные', icon: Database },
    { id: 'tools' as const, label: 'Инструменты', icon: Wrench },
    { id: 'security' as const, label: 'Доступ', icon: Lock },
  ];

  const totalBookmarksCount = stats.all + stats.trash;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[680px] max-h-[88vh] flex flex-col rounded-xl bg-white dark:bg-[#222429] border border-[#E6E8EC] dark:border-[#34373E] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#E6E8EC] dark:border-[#30333A] flex items-center justify-between shrink-0">
          <h2 className="text-[15px] font-semibold text-[#181A1F] dark:text-[#F1F3F5]">
            Настройки Dropkeep
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть настройки"
            className="w-8 h-8 rounded-md flex items-center justify-center text-[#8B929E] hover:bg-[#F4F5F7] dark:hover:bg-[#30333A]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 pt-2 border-b border-[#E6E8EC] dark:border-[#30333A] flex items-center gap-1 overflow-x-auto shrink-0">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3.5 py-2 text-[13px] font-medium flex items-center gap-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-[#0B72E7] text-[#0B72E7] dark:text-[#58A6FF]'
                    : 'border-transparent text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'app' && (
            <div className="space-y-5">
              {/* Group 1: Visual Appearance */}
              <div className="space-y-4">
                {/* Theme Swatches (Raindrop-style mini windows) */}
                <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 sm:gap-4 items-start">
                  <div className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3] sm:text-right sm:pt-2">
                    Тема
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {THEME_OPTIONS.map((opt) => {
                      const active = preferences.theme === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => onUpdatePreferences({ theme: opt.id })}
                          className="group flex flex-col items-center gap-1.5 focus:outline-none"
                          title={opt.label}
                        >
                          <div
                            className={`w-[68px] h-[48px] rounded-lg overflow-hidden flex border-2 transition-all ${
                              active
                                ? 'border-[#0B72E7] ring-2 ring-[#0B72E7]/20'
                                : 'border-[#D9DDE5] dark:border-[#3A3D46] group-hover:border-[#9CA3AF]'
                            }`}
                          >
                            <div
                              className="w-[24px] h-full p-1.5 flex flex-col gap-1"
                              style={{ backgroundColor: opt.sidebarBg }}
                            >
                              <span
                                className="h-[2.5px] w-full rounded-full opacity-75"
                                style={{ backgroundColor: opt.sidebarLine }}
                              />
                              <span
                                className="h-[2.5px] w-3/4 rounded-full opacity-55"
                                style={{ backgroundColor: opt.sidebarLine }}
                              />
                              <span
                                className="h-[2.5px] w-2/3 rounded-full opacity-40"
                                style={{ backgroundColor: opt.sidebarLine }}
                              />
                            </div>
                            <div
                              className="flex-1 h-full p-1.5 grid grid-cols-3 gap-1 content-start"
                              style={{ backgroundColor: opt.mainBg }}
                            >
                              {Array.from({ length: 6 }).map((_, idx) => (
                                <span
                                  key={idx}
                                  className="h-[9px] rounded-[2px]"
                                  style={{ backgroundColor: opt.cardBg }}
                                />
                              ))}
                            </div>
                          </div>
                          <span
                            className={`text-[11.5px] ${
                              active
                                ? 'font-medium text-[#0B72E7] dark:text-[#58A6FF]'
                                : 'text-[#5F6672] dark:text-[#A1A7B3]'
                            }`}
                          >
                            {opt.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Fallback Cover Style Selector */}
                <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 sm:gap-4 items-start">
                  <div className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3] sm:text-right sm:pt-2">
                    Фон без превью
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {FALLBACK_COVER_OPTIONS.map((opt) => {
                      const active = preferences.fallbackCoverStyle === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => onUpdatePreferences({ fallbackCoverStyle: opt.id })}
                          title={opt.description}
                          className="group flex flex-col items-center gap-1.5 focus:outline-none"
                        >
                          <div
                            className={`w-full h-[46px] rounded-lg relative overflow-hidden flex items-center justify-center border-2 transition-all ${
                              active
                                ? 'border-[#0B72E7] ring-2 ring-[#0B72E7]/20'
                                : 'border-[#D9DDE5] dark:border-[#3A3D46] group-hover:border-[#9CA3AF]'
                            } ${
                              opt.id === 'minimal'
                                ? 'bg-[#F2F4F7] dark:bg-[#26282E]'
                                : opt.id === 'soft-tint'
                                  ? 'bg-gradient-to-br from-[#EDF3FA] to-[#E3ECF7] dark:from-[#232A35] dark:to-[#1E242E]'
                                  : opt.id === 'monochrome'
                                    ? 'bg-[#EBEEF2] dark:bg-[#24262B]'
                                    : opt.id === 'paper'
                                      ? 'bg-[#F5EFE2] dark:bg-[#2B2721]'
                                      : 'bg-[#F4F5F7] dark:bg-[#27292E]'
                            }`}
                          >
                            {opt.id === 'dots' && (
                              <div
                                className="absolute inset-0 text-[#9CA3AF] opacity-[0.28]"
                                style={{
                                  backgroundImage:
                                    'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
                                  backgroundSize: '8px 8px',
                                }}
                              />
                            )}
                            {opt.id === 'monochrome' ? (
                              <span className="relative w-6 h-6 rounded-full border border-[#D1D6E0] dark:border-[#3B3F49] bg-[#F8F9FA] dark:bg-[#1C1E22] flex items-center justify-center text-[11px] font-semibold text-[#4B5563] dark:text-[#B4BAC6]">
                                D
                              </span>
                            ) : (
                              <span
                                className={`relative w-6 h-6 rounded-md border flex items-center justify-center ${
                                  opt.id === 'paper'
                                    ? 'bg-[#FBF8F1] dark:bg-[#221F1A] border-[#E5DAC5] dark:border-[#3D372E] text-[#7A6B54] dark:text-[#C5B69C]'
                                    : opt.id === 'soft-tint'
                                      ? 'bg-white/75 dark:bg-black/20 border-white/60 dark:border-white/10 text-[#4C6588] dark:text-[#93AFCF]'
                                      : 'bg-white/90 dark:bg-[#1E2025] border-[#E2E5EB] dark:border-[#363A43] text-[#646D7A] dark:text-[#9DA4B0]'
                                }`}
                              >
                                <LayoutGrid className="w-3 h-3" />
                              </span>
                            )}
                          </div>
                          <span
                            className={`text-[11px] leading-tight text-center ${
                              active
                                ? 'font-medium text-[#0B72E7] dark:text-[#58A6FF]'
                                : 'text-[#5F6672] dark:text-[#A1A7B3]'
                            }`}
                          >
                            {opt.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Font Size */}
                <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 sm:gap-4 items-center">
                  <div className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3] sm:text-right">
                    Размер шрифта
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none w-fit">
                    <input
                      type="checkbox"
                      checked={preferences.largeFont}
                      onChange={(e) => onUpdatePreferences({ largeFont: e.target.checked })}
                      className="w-4 h-4 rounded accent-[#0B72E7]"
                    />
                    <span className="text-[13.5px] text-[#181A1F] dark:text-[#F1F3F5]">Крупный</span>
                  </label>
                </div>
              </div>

              <hr className="border-[#ECEEF2] dark:border-[#30333A]" />

              {/* Group 2: Layout & Interaction */}
              <div className="space-y-4">
                {/* Default View Mode */}
                <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 sm:gap-4 items-center">
                  <label
                    htmlFor="pref-default-view"
                    className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3] sm:text-right"
                  >
                    Вид по умолчанию
                  </label>
                  <select
                    id="pref-default-view"
                    value={preferences.defaultViewMode}
                    onChange={(e) =>
                      onUpdatePreferences({ defaultViewMode: e.target.value as ViewMode })
                    }
                    className="h-9 px-3 rounded-lg text-[13px] bg-white dark:bg-[#2A2C32] border border-[#D4DCE6] dark:border-[#3A3D46] text-[#181A1F] dark:text-[#F1F3F5] focus:border-[#0B72E7] focus:outline-none w-full max-w-[260px]"
                  >
                    {VIEW_MODE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Bookmark Click Action */}
                <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 sm:gap-4 items-center">
                  <label
                    htmlFor="pref-click-action"
                    className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3] sm:text-right"
                  >
                    Клик по закладке
                  </label>
                  <select
                    id="pref-click-action"
                    value={preferences.clickAction}
                    onChange={(e) =>
                      onUpdatePreferences({ clickAction: e.target.value as BookmarkClickAction })
                    }
                    className="h-9 px-3 rounded-lg text-[13px] bg-white dark:bg-[#2A2C32] border border-[#D4DCE6] dark:border-[#3A3D46] text-[#181A1F] dark:text-[#F1F3F5] focus:border-[#0B72E7] focus:outline-none w-full max-w-[260px]"
                  >
                    {CLICK_ACTION_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Card Quick-Action Buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 sm:gap-4 items-start">
                  <div className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3] sm:text-right sm:pt-2">
                    Кнопки
                  </div>
                  <div className="space-y-1.5">
                    <div className="inline-flex items-center gap-1 p-1 rounded-lg border border-[#D4DCE6] dark:border-[#3A3D46] bg-[#F8F9FB] dark:bg-[#272A30]">
                      {CARD_BUTTON_OPTIONS.map((btn) => {
                        const Icon = btn.icon;
                        const active = preferences.cardButtons.includes(btn.id);
                        return (
                          <button
                            key={btn.id}
                            type="button"
                            onClick={() => handleToggleCardButton(btn.id)}
                            title={`${btn.label} (${active ? 'включено' : 'выключено'})`}
                            aria-pressed={active}
                            className={`w-8 h-7 rounded-md flex items-center justify-center transition-colors ${
                              active
                                ? 'bg-white dark:bg-[#1E2025] text-[#0B72E7] dark:text-[#58A6FF] shadow-xs ring-1 ring-[#D4DCE6] dark:ring-[#3E424C]'
                                : 'text-[#9CA3AF] dark:text-[#636A76] opacity-55 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11.5px] text-[#8B929E] dark:text-[#8E96A4]">
                      Нажимайте на иконки, чтобы выбрать кнопки быстрого меню при наведении на карточку.
                    </p>
                  </div>
                </div>

                {/* Show Type Badge on Preview */}
                <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 sm:gap-4 items-center">
                  <div className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3] sm:text-right">
                    Метка на превью
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none w-fit">
                    <input
                      type="checkbox"
                      checked={preferences.showTypeBadge}
                      onChange={(e) => onUpdatePreferences({ showTypeBadge: e.target.checked })}
                      className="w-4 h-4 rounded accent-[#0B72E7]"
                    />
                    <span className="text-[13.5px] text-[#181A1F] dark:text-[#F1F3F5]">
                      Показывать тип закладки (Статья, Видео, Ссылка…)
                    </span>
                  </label>
                </div>
              </div>

              <hr className="border-[#ECEEF2] dark:border-[#30333A]" />

              {/* Group 3: Organization & Safety */}
              <div className="space-y-4">
                {/* Tag Sort */}
                <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 sm:gap-4 items-start">
                  <div className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3] sm:text-right sm:pt-0.5">
                    Сортировать теги
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                      <input
                        type="radio"
                        name="pref-tag-sort"
                        checked={preferences.tagSort === 'name'}
                        onChange={() => onUpdatePreferences({ tagSort: 'name' })}
                        className="w-4 h-4 accent-[#0B72E7]"
                      />
                      <span className="text-[13.5px] text-[#181A1F] dark:text-[#F1F3F5]">
                        По имени
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer select-none w-fit">
                      <input
                        type="radio"
                        name="pref-tag-sort"
                        checked={preferences.tagSort === 'count'}
                        onChange={() => onUpdatePreferences({ tagSort: 'count' })}
                        className="w-4 h-4 accent-[#0B72E7]"
                      />
                      <span className="text-[13.5px] text-[#181A1F] dark:text-[#F1F3F5]">
                        По количеству закладок
                      </span>
                    </label>
                  </div>
                </div>

                {/* Nested Collections */}
                <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 sm:gap-4 items-center">
                  <div className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3] sm:text-right">
                    Вложенные коллекции
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none w-fit">
                    <input
                      type="checkbox"
                      checked={preferences.includeNested}
                      onChange={(e) => onUpdatePreferences({ includeNested: e.target.checked })}
                      className="w-4 h-4 rounded accent-[#0B72E7]"
                    />
                    <span className="text-[13.5px] text-[#181A1F] dark:text-[#F1F3F5]">
                      Показывать закладки из подпапок
                    </span>
                  </label>
                </div>

                {/* Confirm Permanent Delete */}
                <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 sm:gap-4 items-center">
                  <div className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3] sm:text-right">
                    Удаление навсегда
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none w-fit">
                    <input
                      type="checkbox"
                      checked={preferences.confirmPermanentDelete}
                      onChange={(e) =>
                        onUpdatePreferences({ confirmPermanentDelete: e.target.checked })
                      }
                      className="w-4 h-4 rounded accent-[#0B72E7]"
                    />
                    <span className="text-[13.5px] text-[#181A1F] dark:text-[#F1F3F5]">
                      Запрашивать подтверждение
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {tab === 'data' && (
            <div className="space-y-5">
              {/* Storage Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E]">
                  <div className="text-[11.5px] text-[#5F6672] dark:text-[#A1A7B3]">
                    Закладок в базе
                  </div>
                  <div className="text-[17px] font-semibold tabular-nums text-[#181A1F] dark:text-[#F1F3F5] mt-0.5">
                    {stats.all}
                    {stats.trash > 0 && (
                      <span className="text-[12px] font-normal text-[#8B929E] ml-1">
                        (+{stats.trash} в корзине)
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E]">
                  <div className="text-[11.5px] text-[#5F6672] dark:text-[#A1A7B3]">База SQLite</div>
                  <div className="text-[17px] font-semibold tabular-nums text-[#181A1F] dark:text-[#F1F3F5] mt-0.5">
                    {formatBytes(stats.dbSizeBytes)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E]">
                  <div className="text-[11.5px] text-[#5F6672] dark:text-[#A1A7B3]">
                    Офлайн PDF ({stats.offline})
                  </div>
                  <div className="text-[17px] font-semibold tabular-nums text-[#181A1F] dark:text-[#F1F3F5] mt-0.5">
                    {formatBytes(stats.snapshotsSizeBytes)}
                  </div>
                </div>
              </div>

              {/* Import */}
              <div className="space-y-2.5">
                <div>
                  <h3 className="text-[13.5px] font-semibold text-[#181A1F] dark:text-[#F1F3F5]">
                    Импорт закладок
                  </h3>
                  <p className="text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3]">
                    Raindrop.io, Chrome, Firefox, Safari — форматы Netscape HTML, CSV и JSON.
                  </p>
                </div>

                <label className="block border border-dashed border-[#C7D0DC] dark:border-[#424650] hover:border-[#0B72E7] rounded-xl p-5 text-center cursor-pointer transition-colors bg-[#F8F9FB] dark:bg-[#272A30]">
                  <input
                    type="file"
                    accept=".html,.htm,.csv,.json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                      e.target.value = '';
                    }}
                  />
                  <Upload className="w-5 h-5 mx-auto text-[#0B72E7] mb-1.5" />
                  <div className="text-[13px] font-medium text-[#181A1F] dark:text-[#F1F3F5]">
                    {importing ? 'Импорт файла...' : 'Выберите файл .html, .csv или .json'}
                  </div>
                  <div className="text-[11.5px] text-[#8B929E] mt-0.5">
                    Сохраняется дерево коллекций, теги и даты добавления
                  </div>
                </label>

                {importStatus && (
                  <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-[12.5px] text-emerald-700 dark:text-emerald-300">
                    {importStatus}
                  </div>
                )}
                {importError && (
                  <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[12.5px] text-red-700 dark:text-red-300">
                    {importError}
                  </div>
                )}
              </div>

              {/* Export */}
              <div className="space-y-2.5">
                <div>
                  <h3 className="text-[13.5px] font-semibold text-[#181A1F] dark:text-[#F1F3F5]">
                    Экспорт и резервная копия
                  </h3>
                  <p className="text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3]">
                    Выгрузите библиотеку в открытом формате в любой момент.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => api.downloadExport('html')}
                    className="p-3 rounded-lg border border-[#E2E5EB] dark:border-[#34373E] hover:border-[#0B72E7] text-left transition-colors bg-white dark:bg-[#272A30]"
                  >
                    <div className="text-[13px] font-medium text-[#181A1F] dark:text-[#F1F3F5] flex items-center justify-between">
                      <span>Netscape HTML</span>
                      <Download className="w-3.5 h-3.5 text-[#0B72E7]" />
                    </div>
                    <div className="text-[11.5px] text-[#7A828F] dark:text-[#8E96A4] mt-0.5">
                      Для браузеров и Raindrop
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => api.downloadExport('json')}
                    className="p-3 rounded-lg border border-[#E2E5EB] dark:border-[#34373E] hover:border-[#0B72E7] text-left transition-colors bg-white dark:bg-[#272A30]"
                  >
                    <div className="text-[13px] font-medium text-[#181A1F] dark:text-[#F1F3F5] flex items-center justify-between">
                      <span>Бэкап JSON</span>
                      <Download className="w-3.5 h-3.5 text-[#0B72E7]" />
                    </div>
                    <div className="text-[11.5px] text-[#7A828F] dark:text-[#8E96A4] mt-0.5">
                      Заметки, цитаты и метаданные
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => api.downloadExport('csv')}
                    className="p-3 rounded-lg border border-[#E2E5EB] dark:border-[#34373E] hover:border-[#0B72E7] text-left transition-colors bg-white dark:bg-[#272A30]"
                  >
                    <div className="text-[13px] font-medium text-[#181A1F] dark:text-[#F1F3F5] flex items-center justify-between">
                      <span>Таблица CSV</span>
                      <Download className="w-3.5 h-3.5 text-[#0B72E7]" />
                    </div>
                    <div className="text-[11.5px] text-[#7A828F] dark:text-[#8E96A4] mt-0.5">
                      Совместим с Excel и Raindrop
                    </div>
                  </button>
                </div>
              </div>

              {/* Danger Zone: Delete All Bookmarks */}
              <div className="p-4 rounded-xl border border-red-200/90 dark:border-red-900/60 bg-red-50/45 dark:bg-red-950/20 space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  <div className="space-y-1 min-w-0">
                    <h3 className="text-[13.5px] font-semibold text-red-700 dark:text-red-300">
                      Удалить все закладки
                    </h3>
                    <p className="text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3] leading-relaxed">
                      Удобно, чтобы очистить стартовые примеры или начать с чистого листа. Удаляются все закладки, корзина, заметки, офлайн PDF и локальные обложки — стартовые закладки повторно не создадутся.
                    </p>
                  </div>
                </div>

                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={deleteCollectionsToo}
                    onChange={(e) => setDeleteCollectionsToo(e.target.checked)}
                    disabled={deletingAll}
                    className="w-4 h-4 rounded accent-red-600"
                  />
                  <span className="text-[12.5px] text-[#2C313A] dark:text-[#D3D7DF]">
                    Также удалить все коллекции (папки)
                  </span>
                </label>

                {!deleteAllConfirming ? (
                  <div>
                    <button
                      type="button"
                      disabled={deletingAll || (totalBookmarksCount === 0 && !deleteCollectionsToo)}
                      onClick={() => {
                        setDeleteAllStatus('');
                        setDeleteAllError('');
                        setDeleteAllConfirming(true);
                      }}
                      className="h-9 px-3.5 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-[#222429] hover:bg-red-600 hover:text-white hover:border-red-600 text-red-600 dark:text-red-400 text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors disabled:opacity-45 disabled:hover:bg-white disabled:hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>
                        Удалить все закладки
                        {totalBookmarksCount > 0 ? ` (${totalBookmarksCount})` : ''}
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-white dark:bg-[#1E2025] border border-red-300 dark:border-red-800/80 space-y-2.5">
                    <div className="text-[12.5px] font-medium text-[#181A1F] dark:text-[#F1F3F5]">
                      Точно удалить все закладки ({totalBookmarksCount})
                      {deleteCollectionsToo ? ' и все коллекции' : ''}? Это действие нельзя отменить.
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={deletingAll}
                        onClick={handleDeleteAllBookmarks}
                        className="h-8 px-3.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-[12.5px] font-medium inline-flex items-center gap-1.5"
                      >
                        {deletingAll && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>{deletingAll ? 'Удаление...' : 'Да, удалить всё'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={deletingAll}
                        onClick={() => setDeleteAllConfirming(false)}
                        className="h-8 px-3 rounded-lg text-[12.5px] font-medium text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#F3F4F6] dark:hover:bg-[#2E3138]"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                )}

                {deleteAllStatus && (
                  <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-[12.5px] text-emerald-700 dark:text-emerald-300">
                    {deleteAllStatus}
                  </div>
                )}
                {deleteAllError && (
                  <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[12.5px] text-red-700 dark:text-red-300">
                    {deleteAllError}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'tools' && (
            <div className="space-y-5">
              {/* Bookmarklet */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <BookmarkPlus className="w-4 h-4 text-[#0B72E7]" />
                  <h3 className="text-[13.5px] font-semibold text-[#181A1F] dark:text-[#F1F3F5]">
                    Букмарклет для браузера
                  </h3>
                </div>

                <div className="p-3.5 rounded-xl bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-[13px] font-medium text-[#181A1F] dark:text-[#F1F3F5]">
                      Перетащите кнопку на панель закладок
                    </div>
                    <div className="text-[12px] text-[#5F6672] dark:text-[#A1A7B3]">
                      Показать панель:{' '}
                      <kbd className="px-1 py-0.5 rounded bg-white dark:bg-[#1E2025] border border-[#DCE0E6] dark:border-[#3A3D46] text-[11px] font-mono">
                        Ctrl+Shift+B
                      </kbd>{' '}
                      /{' '}
                      <kbd className="px-1 py-0.5 rounded bg-white dark:bg-[#1E2025] border border-[#DCE0E6] dark:border-[#3A3D46] text-[11px] font-mono">
                        ⌘+Shift+B
                      </kbd>
                    </div>
                  </div>

                  <a
                    ref={bookmarkletLinkRef}
                    draggable
                    onClick={(e) => {
                      e.preventDefault();
                      setBookmarkletClickHint(true);
                      window.setTimeout(() => setBookmarkletClickHint(false), 3500);
                    }}
                    title="Перетащите эту кнопку на панель закладок браузера"
                    className="h-9 px-3.5 rounded-lg bg-[#0B72E7] hover:bg-[#0960C5] text-white text-[13px] font-medium inline-flex items-center justify-center gap-1.5 shadow-xs cursor-grab active:cursor-grabbing whitespace-nowrap shrink-0 select-none"
                  >
                    <GripVertical className="w-3.5 h-3.5 opacity-75" />
                    <span>+ Сохранить в Dropkeep</span>
                  </a>
                </div>

                {bookmarkletClickHint && (
                  <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-[12px] text-blue-700 dark:text-blue-300">
                    Зажмите кнопку мышкой и перетащите на панель закладок, либо скопируйте JS-код ниже.
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="url"
                    value={bookmarkletBaseUrl}
                    onChange={(e) => setBookmarkletBaseUrl(e.target.value)}
                    placeholder="https://bookmarks.example.com"
                    aria-label="Адрес вашего Dropkeep"
                    className="flex-1 h-9 px-3 rounded-lg text-[12.5px] font-mono bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
                  />
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(bookmarkletCode).catch(() => {});
                        setCopiedBookmarklet(true);
                        window.setTimeout(() => setCopiedBookmarklet(false), 1500);
                      }}
                      disabled={!normalizedBookmarkletBase}
                      className="h-9 px-3 rounded-lg border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-45"
                    >
                      {copiedBookmarklet ? (
                        <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedBookmarklet ? 'Скопировано' : 'JS-код'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadBookmarkletHtml}
                      disabled={!normalizedBookmarkletBase}
                      className="h-9 px-3 rounded-lg border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[12px] font-medium inline-flex items-center gap-1.5 disabled:opacity-45"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>.html</span>
                    </button>
                  </div>
                </div>
                {!normalizedBookmarkletBase && (
                  <div className="text-[11.5px] text-red-600 dark:text-red-400">
                    Введите корректный адрес, начинающийся с http:// или https://
                  </div>
                )}
              </section>

              <hr className="border-[#ECEEF2] dark:border-[#30333A]" />

              {/* AI Assistant */}
              <section className="space-y-2.5">
                <div className="flex items-start justify-between gap-3 p-3.5 rounded-lg bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E]">
                  <div className="space-y-1 min-w-0">
                    <div className="text-[13px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#0B72E7] shrink-0" />
                      <span>
                        {aiStatus?.configured
                          ? `ИИ подключён (${aiStatus.model})`
                          : 'ИИ-помощник не настроен'}
                      </span>
                    </div>
                    <p className="text-[12px] text-[#5F6672] dark:text-[#A1A7B3] leading-relaxed">
                      {aiStatus?.configured
                        ? `Сервер: ${aiStatus.endpointHost} · ${
                            aiStatus.hasApiKey ? 'API-ключ задан' : 'локальный режим без ключа'
                          } · умный поиск, TL;DR и авто-описание YouTube-видео активны`
                        : 'Опционально: умный поиск, краткие выжимки (TL;DR), авто-описание YouTube-роликов по содержимому и подбор тегов через OpenAI, OpenRouter или локальную Ollama.'}
                    </p>
                  </div>

                  {aiStatus?.configured && (
                    <button
                      type="button"
                      onClick={handleTestAi}
                      disabled={aiTesting}
                      className="h-8 px-3 rounded-lg border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[12px] font-medium text-[#181A1F] dark:text-[#F1F3F5] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
                    >
                      {aiTesting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>{aiTesting ? 'Проверка...' : 'Проверить'}</span>
                    </button>
                  )}
                </div>

                {aiTestMsg && (
                  <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-[12px] text-emerald-700 dark:text-emerald-300">
                    {aiTestMsg}
                  </div>
                )}
                {aiTestError && (
                  <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[12px] text-red-700 dark:text-red-300">
                    {aiTestError}
                  </div>
                )}

                <div>
                  <button
                    type="button"
                    onClick={() => setShowAiEnv((v) => !v)}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#0B72E7] dark:hover:text-[#58A6FF]"
                  >
                    {showAiEnv ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    <span>Показать переменные .env для подключения ИИ</span>
                  </button>
                  {showAiEnv && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(AI_ENV_SNIPPET).catch(() => {});
                            setCopiedAiEnv(true);
                            setTimeout(() => setCopiedAiEnv(false), 1500);
                          }}
                          className="text-[11.5px] text-[#0B72E7] dark:text-[#58A6FF] inline-flex items-center gap-1 hover:underline"
                        >
                          {copiedAiEnv ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedAiEnv ? 'Скопировано' : 'Копировать'}</span>
                        </button>
                      </div>
                      <pre className="p-3 rounded-lg bg-[#16181D] text-[#E2E8F0] text-[11.5px] font-mono overflow-x-auto leading-relaxed">
                        {AI_ENV_SNIPPET}
                      </pre>
                    </div>
                  )}
                </div>
              </section>

              <hr className="border-[#ECEEF2] dark:border-[#30333A]" />

              {/* Server & Docker Info */}
              <section className="space-y-2.5">
                <div className="p-3.5 rounded-lg bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E] space-y-1">
                  <div className="text-[13px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] flex items-center gap-2">
                    <Container className="w-4 h-4 text-[#0B72E7] shrink-0" />
                    <span>Сервер и Docker</span>
                  </div>
                  <div className="text-[12px] text-[#5F6672] dark:text-[#A1A7B3]">
                    PDF-движок:{' '}
                    {stats.pdfEngineStatus === 'chromium_unreachable' ? (
                      <strong className="text-amber-600 dark:text-amber-400 font-medium">
                        Встроенный (Gotenberg недоступен по GOTENBERG_URL)
                      </strong>
                    ) : (
                      <strong className="text-[#181A1F] dark:text-[#F1F3F5] font-medium">
                        {stats.pdfEngine === 'chromium'
                          ? 'Полная страница (Chromium / Gotenberg · подключён)'
                          : 'Встроенный (статья + обложка)'}
                      </strong>
                    )}
                    {' · '}
                    Том данных: <code className="font-mono">/data</code>
                  </div>
                </div>

                <div>
                  <button
                    type="button"
                    onClick={() => setShowDockerCompose((v) => !v)}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#0B72E7] dark:hover:text-[#58A6FF]"
                  >
                    {showDockerCompose ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    <span>Показать пример docker-compose.yml</span>
                  </button>
                  {showDockerCompose && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(DOCKER_COMPOSE_SNIPPET).catch(() => {});
                            setCopiedCompose(true);
                            setTimeout(() => setCopiedCompose(false), 1500);
                          }}
                          className="text-[11.5px] text-[#0B72E7] dark:text-[#58A6FF] inline-flex items-center gap-1 hover:underline"
                        >
                          {copiedCompose ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          <span>{copiedCompose ? 'Скопировано' : 'Копировать'}</span>
                        </button>
                      </div>
                      <pre className="p-3 rounded-lg bg-[#16181D] text-[#E2E8F0] text-[11.5px] font-mono overflow-x-auto leading-relaxed">
                        {DOCKER_COMPOSE_SNIPPET}
                      </pre>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {tab === 'security' && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 p-3.5 rounded-lg bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E]">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-[#0B72E7] shrink-0 mt-0.5" />
                  <div className="text-[13px] space-y-1">
                    <div className="font-semibold text-[#181A1F] dark:text-[#F1F3F5]">
                      {authStatus.authEnabled
                        ? authStatus.source === 'env'
                          ? 'Защита активна (через APP_PASSWORD)'
                          : 'Защита мастер-паролем активна'
                        : 'Открытый локальный режим (без пароля)'}
                    </div>
                    <p className="text-[#5F6672] dark:text-[#A1A7B3] leading-relaxed">
                      {authStatus.authEnabled
                        ? 'Сессия сохраняется в защищённой HttpOnly-cookie на время работы браузера (переживает обновление страницы и новые вкладки, сбрасывается при закрытии браузера).'
                        : 'Для домашней сети за Tailscale можно оставить без пароля. При публикации через обратный прокси (Caddy / Nginx) задайте мастер-пароль здесь или через переменную APP_PASSWORD в Docker.'}
                    </p>
                  </div>
                </div>
                {authStatus.authEnabled && (
                  <button
                    type="button"
                    onClick={handleLogout}
                    disabled={secLoading}
                    className="h-8 px-3 rounded-lg border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[12px] font-medium text-[#181A1F] dark:text-[#F1F3F5] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 disabled:opacity-50"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Выйти</span>
                  </button>
                )}
              </div>

              {secMessage && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-[12.5px] text-emerald-700 dark:text-emerald-300">
                  {secMessage}
                </div>
              )}
              {secError && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[12.5px] text-red-700 dark:text-red-300">
                  {secError}
                </div>
              )}

              {authStatus.source !== 'env' && (
                <form onSubmit={handleSetPassword} className="space-y-3">
                  <div>
                    <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1">
                      {authStatus.authEnabled
                        ? 'Новый мастер-пароль'
                        : 'Установить мастер-пароль (от 6 символов)'}
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Введите надёжный пароль"
                      className="w-full h-9 px-3 rounded-lg text-[13.5px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={secLoading || newPassword.trim().length < 6}
                      className="h-9 px-4 rounded-lg bg-[#0B72E7] hover:bg-[#0960C5] disabled:opacity-50 text-white text-[13px] font-medium"
                    >
                      {authStatus.authEnabled ? 'Сменить пароль' : 'Включить защиту'}
                    </button>
                    {authStatus.authEnabled && (
                      <button
                        type="button"
                        onClick={handleDisablePassword}
                        disabled={secLoading}
                        className="h-9 px-3.5 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 text-[13px] font-medium hover:bg-red-500/10"
                      >
                        Отключить пароль
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
