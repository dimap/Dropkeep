import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookmarkPlus,
  Check,
  Container,
  Copy,
  Download,
  GripVertical,
  Loader2,
  Lock,
  LogOut,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { api, setAuthToken } from '../api';
import type { AiStatus, AuthStatus, SmartStats } from '../types';
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
  onClose: () => void;
  onDataChanged: () => void;
  onAuthChanged: (status: AuthStatus) => void;
}

const DOCKER_COMPOSE_SNIPPET = `services:
  dropkeep:
    build: .
    container_name: dropkeep
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATA_DIR=/data
      # Для полных визуальных PDF-снимков страниц (с профилем full-pdf):
      - GOTENBERG_URL=\${GOTENBERG_URL:-}
      # Своя OpenAI-совместимая ИИ-модель для авто-тегов (OpenAI / OpenRouter / Ollama / vLLM):
      - AI_API_URL=\${AI_API_URL:-}
      - AI_API_KEY=\${AI_API_KEY:-}
      - AI_MODEL=\${AI_MODEL:-}
      # Раскомментируйте для защиты паролем:
      # - APP_PASSWORD=your-strong-password
    volumes:
      - dropkeep_data:/data

  # Опциональный Chromium-рендерер для полного PDF-снимка страницы со стилями:
  gotenberg:
    image: gotenberg/gotenberg:8
    profiles: ["full-pdf"]
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

export function SettingsModal({
  stats,
  authStatus,
  onClose,
  onDataChanged,
  onAuthChanged,
}: SettingsModalProps) {
  const [tab, setTab] = useState<'import' | 'export' | 'bookmarklet' | 'ai' | 'docker' | 'security'>('import');
  const [importStatus, setImportStatus] = useState('');
  const [importError, setImportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [copiedCompose, setCopiedCompose] = useState(false);
  const [copiedAiEnv, setCopiedAiEnv] = useState(false);
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
    { id: 'import' as const, label: 'Импорт', icon: Upload },
    { id: 'export' as const, label: 'Экспорт', icon: Download },
    { id: 'bookmarklet' as const, label: 'Букмарклет', icon: BookmarkPlus },
    { id: 'ai' as const, label: 'ИИ', icon: Sparkles },
    { id: 'docker' as const, label: 'Docker / Сервер', icon: Container },
    { id: 'security' as const, label: 'Доступ', icon: Lock },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[660px] max-h-[88vh] flex flex-col rounded-xl bg-white dark:bg-[#222429] border border-[#E6E8EC] dark:border-[#34373E] shadow-2xl overflow-hidden"
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
        <div className="px-5 pt-2.5 border-b border-[#E6E8EC] dark:border-[#30333A] flex items-center gap-1 overflow-x-auto shrink-0">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-3 py-2 text-[13px] font-medium flex items-center gap-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
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
          {tab === 'import' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-[14px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] mb-1">
                  Перенос из Raindrop.io, Chrome, Firefox или Safari
                </h3>
                <p className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3] leading-relaxed">
                  Поддерживаются стандартные файлы закладок Netscape HTML (сохраняется структура вложенных коллекций и теги), экспорт Raindrop CSV и резервные копии JSON.
                </p>
              </div>

              <label className="block border border-dashed border-[#C7D0DC] dark:border-[#424650] hover:border-[#0B72E7] rounded-xl p-8 text-center cursor-pointer transition-colors bg-[#F8F9FB] dark:bg-[#272A30]">
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
                <Upload className="w-6 h-6 mx-auto text-[#0B72E7] mb-2" />
                <div className="text-[13.5px] font-medium text-[#181A1F] dark:text-[#F1F3F5]">
                  {importing ? 'Импорт файла...' : 'Выберите файл .html, .csv или .json'}
                </div>
                <div className="text-[12px] text-[#8B929E] mt-1">
                  Raindrop.io → Settings → Backups → Export HTML или CSV
                </div>
              </label>

              {importStatus && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-[13px] text-emerald-700 dark:text-emerald-300">
                  {importStatus}
                </div>
              )}
              {importError && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[13px] text-red-700 dark:text-red-300">
                  {importError}
                </div>
              )}
            </div>
          )}

          {tab === 'export' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-[14px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] mb-1">
                  Экспорт и резервное копирование
                </h3>
                <p className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3]">
                  Выгрузите все закладки, коллекции и теги в открытом формате без привязки к платформе.
                </p>
              </div>

              <div className="divide-y divide-[#ECEEF2] dark:divide-[#30333A] border border-[#E6E8EC] dark:border-[#34373E] rounded-lg">
                <div className="p-3.5 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[13.5px] font-medium text-[#181A1F] dark:text-[#F1F3F5]">
                      Netscape HTML (.html)
                    </div>
                    <div className="text-[12px] text-[#5F6672] dark:text-[#A1A7B3]">
                      Совместим с Raindrop.io, Chrome, Firefox и Safari, сохраняет дерево папок.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => api.downloadExport('html')}
                    className="h-9 px-3.5 rounded-lg border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[12.5px] font-medium whitespace-nowrap shrink-0"
                  >
                    Скачать HTML
                  </button>
                </div>

                <div className="p-3.5 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[13.5px] font-medium text-[#181A1F] dark:text-[#F1F3F5]">
                      Полный бэкап JSON (.json)
                    </div>
                    <div className="text-[12px] text-[#5F6672] dark:text-[#A1A7B3]">
                      Включает заметки, выделения, офлайн-текст, коллекции и метаданные.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => api.downloadExport('json')}
                    className="h-9 px-3.5 rounded-lg border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[12.5px] font-medium whitespace-nowrap shrink-0"
                  >
                    Скачать JSON
                  </button>
                </div>

                <div className="p-3.5 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[13.5px] font-medium text-[#181A1F] dark:text-[#F1F3F5]">
                      Таблица CSV (.csv)
                    </div>
                    <div className="text-[12px] text-[#5F6672] dark:text-[#A1A7B3]">
                      Формат, совместимый с экспортом Raindrop.io и электронными таблицами.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => api.downloadExport('csv')}
                    className="h-9 px-3.5 rounded-lg border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[12.5px] font-medium whitespace-nowrap shrink-0"
                  >
                    Скачать CSV
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'bookmarklet' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-[14px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] mb-1">
                  Закладка-скрипт (букмарклет) для браузера
                </h3>
                <p className="text-[13px] text-[#5F6672] dark:text-[#A1A7B3] leading-relaxed">
                  Сохраните этот JS-скрипт как обычную закладку в браузере. При нажатии на неё на любом сайте автоматически откроется окно создания закладки в Dropkeep с текущим URL, заголовком и выделенным текстом.
                </p>
              </div>

              {/* Draggable Bookmarklet Action Box */}
              <div className="p-4 rounded-xl bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-[13px] font-medium text-[#181A1F] dark:text-[#F1F3F5]">
                    Перетащите кнопку на панель закладок
                  </div>
                  <div className="text-[12px] text-[#5F6672] dark:text-[#A1A7B3]">
                    Показать панель закладок: <kbd className="px-1 py-0.5 rounded bg-white dark:bg-[#1E2025] border border-[#DCE0E6] dark:border-[#3A3D46] text-[11px] font-mono">Ctrl+Shift+B</kbd> / <kbd className="px-1 py-0.5 rounded bg-white dark:bg-[#1E2025] border border-[#DCE0E6] dark:border-[#3A3D46] text-[11px] font-mono">⌘+Shift+B</kbd>
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
                <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-[12.5px] text-blue-700 dark:text-blue-300">
                  Не нажимайте на кнопку здесь — зажмите её мышкой и перетащите на панель закладок браузера, либо скопируйте JS-код ниже.
                </div>
              )}

              {/* Base URL customization for self-hosted deployments */}
              <div>
                <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1">
                  Адрес вашего Dropkeep (можно указать свой домен или IP в сети)
                </label>
                <input
                  type="url"
                  value={bookmarkletBaseUrl}
                  onChange={(e) => setBookmarkletBaseUrl(e.target.value)}
                  placeholder="https://bookmarks.example.com"
                  className="w-full h-9 px-3 rounded-lg text-[13px] font-mono bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
                />
                {!normalizedBookmarkletBase && (
                  <div className="mt-1 text-[11.5px] text-red-600 dark:text-red-400">
                    Введите корректный адрес, начинающийся с http:// или https://
                  </div>
                )}
              </div>

              {/* Raw JS code + Copy & HTML download */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-[#181A1F] dark:text-[#F1F3F5]">
                    JS-код для ручного добавления (в том числе на телефоне)
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleDownloadBookmarkletHtml}
                      disabled={!normalizedBookmarkletBase}
                      className="text-[12px] text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#0B72E7] dark:hover:text-[#58A6FF] inline-flex items-center gap-1 disabled:opacity-45"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Скачать .html</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(bookmarkletCode).catch(() => {});
                        setCopiedBookmarklet(true);
                        window.setTimeout(() => setCopiedBookmarklet(false), 1500);
                      }}
                      disabled={!normalizedBookmarkletBase}
                      className="text-[12px] text-[#0B72E7] dark:text-[#58A6FF] inline-flex items-center gap-1 hover:underline disabled:opacity-45"
                    >
                      {copiedBookmarklet ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedBookmarklet ? 'Скопировано' : 'Копировать код'}</span>
                    </button>
                  </div>
                </div>
                <pre className="p-3 rounded-lg bg-[#16181D] text-[#E2E8F0] text-[11.5px] font-mono overflow-x-auto whitespace-pre-wrap break-all leading-relaxed max-h-32">
                  {bookmarkletCode}
                </pre>
              </div>

              <div className="p-3 rounded-lg bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E] text-[12px] text-[#5F6672] dark:text-[#A1A7B3] space-y-1 leading-relaxed">
                <div>
                  <strong className="text-[#181A1F] dark:text-[#F1F3F5] font-medium">На телефоне / вручную:</strong>{' '}
                  добавьте любую страницу в закладки браузера, затем откройте её редактирование и замените поле URL на скопированный JS-код.
                </div>
                <div>
                  <strong className="text-[#181A1F] dark:text-[#F1F3F5] font-medium">Через импорт:</strong>{' '}
                  скачайте файл <code className="font-mono">dropkeep-bookmarklet.html</code> и импортируйте его в закладки Chrome, Firefox, Edge или Safari.
                </div>
              </div>
            </div>
          )}

          {tab === 'ai' && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3 p-3.5 rounded-lg bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E]">
                <div className="space-y-1 min-w-0">
                  <div className="text-[13.5px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#0B72E7] shrink-0" />
                    <span>
                      {aiStatus?.configured
                        ? 'Подключена собственная ИИ-модель'
                        : 'ИИ-модель пока не настроена'}
                    </span>
                  </div>
                  {aiStatus?.configured ? (
                    <div className="text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3] space-y-0.5">
                      <div>
                        Сервер: <code className="font-mono text-[#181A1F] dark:text-[#F1F3F5]">{aiStatus.endpointHost}</code>
                      </div>
                      <div>
                        Модель: <code className="font-mono text-[#181A1F] dark:text-[#F1F3F5]">{aiStatus.model}</code>
                      </div>
                      <div>
                        API-ключ: {aiStatus.hasApiKey ? 'задан в переменных сервера' : 'не задан (локальный режим без ключа)'}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3] leading-relaxed">
                      Поддерживается любой OpenAI-совместимый API: OpenAI, OpenRouter, DeepSeek, Ollama, vLLM, LM Studio и LiteLLM.
                      Для безопасности адрес API и ключ задаются на сервере через переменные окружения <code className="font-mono">.env</code> или <code className="font-mono">docker-compose.yml</code>.
                    </p>
                  )}
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
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-[12.5px] text-emerald-700 dark:text-emerald-300">
                  {aiTestMsg}
                </div>
              )}
              {aiTestError && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[12.5px] text-red-700 dark:text-red-300">
                  {aiTestError}
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold text-[#181A1F] dark:text-[#F1F3F5]">
                    Настройка в .env или docker-compose.yml
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(AI_ENV_SNIPPET).catch(() => {});
                      setCopiedAiEnv(true);
                      setTimeout(() => setCopiedAiEnv(false), 1500);
                    }}
                    className="text-[12px] text-[#0B72E7] dark:text-[#58A6FF] inline-flex items-center gap-1 hover:underline"
                  >
                    {copiedAiEnv ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedAiEnv ? 'Скопировано' : 'Копировать'}</span>
                  </button>
                </div>
                <pre className="p-3.5 rounded-lg bg-[#16181D] text-[#E2E8F0] text-[12px] font-mono overflow-x-auto leading-relaxed">
                  {AI_ENV_SNIPPET}
                </pre>
              </div>

              <div className="p-3 rounded-lg bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E] text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3] leading-relaxed">
                ИИ запускается только вручную по запросу: умный поиск по смыслу в строке поиска, краткая выжимка (TL;DR) по статье, а также подбор описания, коллекции и 2–3 тегов. Если ИИ не настроен, все кнопки ИИ автоматически скрыты и не занимают место в интерфейсе.
              </div>
            </div>
          )}

          {tab === 'docker' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E]">
                  <div className="text-[11.5px] text-[#5F6672] dark:text-[#A1A7B3]">Закладок в базе</div>
                  <div className="text-[18px] font-semibold tabular-nums text-[#181A1F] dark:text-[#F1F3F5] mt-0.5">
                    {stats.all}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E]">
                  <div className="text-[11.5px] text-[#5F6672] dark:text-[#A1A7B3]">База SQLite</div>
                  <div className="text-[18px] font-semibold tabular-nums text-[#181A1F] dark:text-[#F1F3F5] mt-0.5">
                    {formatBytes(stats.dbSizeBytes)}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E]">
                  <div className="text-[11.5px] text-[#5F6672] dark:text-[#A1A7B3]">
                    Офлайн PDF ({stats.offline})
                  </div>
                  <div className="text-[18px] font-semibold tabular-nums text-[#181A1F] dark:text-[#F1F3F5] mt-0.5">
                    {formatBytes(stats.snapshotsSizeBytes)}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold text-[#181A1F] dark:text-[#F1F3F5]">
                    docker-compose.yml (включён в корень проекта)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(DOCKER_COMPOSE_SNIPPET).catch(() => {});
                      setCopiedCompose(true);
                      setTimeout(() => setCopiedCompose(false), 1500);
                    }}
                    className="text-[12px] text-[#0B72E7] dark:text-[#58A6FF] inline-flex items-center gap-1 hover:underline"
                  >
                    {copiedCompose ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedCompose ? 'Скопировано' : 'Копировать'}</span>
                  </button>
                </div>
                <pre className="p-3.5 rounded-lg bg-[#16181D] text-[#E2E8F0] text-[12px] font-mono overflow-x-auto leading-relaxed">
                  {DOCKER_COMPOSE_SNIPPET}
                </pre>
              </div>

              <div className="p-3 rounded-lg bg-[#F6F7F9] dark:bg-[#272A30] border border-[#E6E8EC] dark:border-[#34373E] text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3] space-y-1.5">
                <div>
                  Активный PDF-движок:{' '}
                  <strong className="text-[#181A1F] dark:text-[#F1F3F5] font-medium">
                    {stats.pdfEngine === 'chromium'
                      ? 'Полная страница (Chromium / Gotenberg)'
                      : 'Встроенный (статья + обложка)'}
                  </strong>
                </div>
                <div>
                  Лёгкий запуск (x86_64 / ARM64 / Raspberry Pi):{' '}
                  <code className="text-[#181A1F] dark:text-[#F1F3F5] font-mono">
                    docker compose up -d --build
                  </code>
                </div>
                <div>
                  Запуск с браузером Chromium (полные PDF-снимки и лёгкие WebP-скриншоты обложек 800×500 при их отсутствии):{' '}
                  <code className="text-[#181A1F] dark:text-[#F1F3F5] font-mono">
                    GOTENBERG_URL=http://gotenberg:3000 docker compose --profile full-pdf up -d --build
                  </code>
                </div>
                <div>
                  База хранится в{' '}
                  <code className="text-[#181A1F] dark:text-[#F1F3F5] font-mono">/data/dropkeep.db</code>, PDF-снимки — в{' '}
                  <code className="text-[#181A1F] dark:text-[#F1F3F5] font-mono">/data/snapshots/</code>, а скриншоты обложек — в{' '}
                  <code className="text-[#181A1F] dark:text-[#F1F3F5] font-mono">/data/covers/</code> внутри одного Docker-тома.
                </div>
              </div>
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
                      {authStatus.authEnabled ? 'Новый мастер-пароль' : 'Установить мастер-пароль (от 6 символов)'}
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
