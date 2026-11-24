import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { api } from '../api';
import type { Bookmark } from '../types';
import { formatBytes, formatShortDate, isSafeExternalHref } from '../utils/icons';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfViewerModalProps {
  bookmark: Bookmark;
  onClose: () => void;
  onRefreshSnapshot: () => Promise<void>;
  refreshing: boolean;
}

function PdfPageCanvas({
  pdfDoc,
  pageNumber,
  scale,
}: {
  pdfDoc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    pdfDoc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale });
        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        renderTask = page.render({
          canvasContext: context,
          viewport,
          canvas,
        });
        return renderTask.promise;
      })
      .catch(() => {
        // Ignore cancelled renders on zoom/unmount
      });

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // ignore
      }
    };
  }, [pdfDoc, pageNumber, scale]);

  return (
    <div className="bg-white shadow-md rounded-xs overflow-hidden max-w-full">
      <canvas ref={canvasRef} className="block max-w-full h-auto" />
    </div>
  );
}

export function PdfViewerModal({
  bookmark,
  onClose,
  onRefreshSnapshot,
  refreshing,
}: PdfViewerModalProps) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(() => (window.innerWidth < 640 ? 0.65 : 1.15));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;

    setLoading(true);
    setError('');
    setPdfDoc(null);
    setNumPages(0);

    api
      .fetchPdfSnapshotBuffer(bookmark.id)
      .then((buffer) => {
        if (!active) return null;
        loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
        return loadingTask.promise;
      })
      .then((doc) => {
        if (!doc) return;
        if (!active) {
          loadingTask?.destroy().catch(() => {});
          return;
        }
        setPdfDoc(doc);
        setNumPages(doc.numPages);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Не удалось отобразить PDF');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      loadingTask?.destroy().catch(() => {});
    };
  }, [bookmark.id, bookmark.snapshot_created_at]);

  const handleDownload = async () => {
    try {
      await api.downloadPdfSnapshot(bookmark.id, bookmark.title);
    } catch {
      // ignore
    }
  };

  const zoomPercent = Math.round(scale * 100);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-5"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[980px] h-[92vh] flex flex-col rounded-xl bg-white dark:bg-[#1E1F23] border border-[#E6E8EC] dark:border-[#34373E] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-[#E6E8EC] dark:border-[#2B2D32] flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-[#181A1F] dark:text-[#F1F3F5] truncate">
              {bookmark.title}
            </h2>
            <div className="text-[12px] text-[#7A828F] dark:text-[#8E96A4] flex items-center gap-2 tabular-nums">
              <span>PDF</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(bookmark.snapshot_size)}</span>
              {numPages > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{numPages} стр.</span>
                </>
              )}
              {bookmark.snapshot_created_at && (
                <>
                  <span aria-hidden="true" className="hidden sm:inline">·</span>
                  <span className="hidden sm:inline">{formatShortDate(bookmark.snapshot_created_at)}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Zoom Controls */}
            {pdfDoc && (
              <div className="hidden sm:flex items-center rounded-lg bg-[#F4F5F7] dark:bg-[#2A2C31] p-0.5 mr-1">
                <button
                  type="button"
                  onClick={() => setScale((s) => Math.max(0.5, Number((s - 0.15).toFixed(2))))}
                  aria-label="Уменьшить масштаб"
                  className="w-7 h-7 rounded flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="px-1.5 text-[11.5px] font-medium tabular-nums text-[#2C313A] dark:text-[#D3D7DF] w-11 text-center">
                  {zoomPercent}%
                </span>
                <button
                  type="button"
                  onClick={() => setScale((s) => Math.min(2.2, Number((s + 0.15).toFixed(2))))}
                  aria-label="Увеличить масштаб"
                  className="w-7 h-7 rounded flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={onRefreshSnapshot}
              disabled={refreshing}
              title="Обновить PDF-снимок со страницы"
              className="h-8 px-2.5 rounded-lg border border-[#E2E5EB] dark:border-[#383B42] text-[12px] font-medium text-[#2C313A] dark:text-[#E5E7EB] hover:border-[#0B72E7] inline-flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">Обновить</span>
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="h-8 px-3 rounded-lg bg-[#0B72E7] hover:bg-[#0960C5] text-white text-[12px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Скачать PDF</span>
            </button>

            {isSafeExternalHref(bookmark.url) && (
              <a
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                title="Открыть оригинал"
                className="w-8 h-8 rounded-lg border border-[#E2E5EB] dark:border-[#383B42] flex items-center justify-center text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#0B72E7]"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть просмотр PDF"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8B929E] hover:bg-[#F3F4F6] dark:hover:bg-[#30333A]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Canvas PDF Pages Container (Zero iframe blocking!) */}
        <div className="flex-1 overflow-auto bg-[#E9ECEF] dark:bg-[#141518] p-3 sm:p-6">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-[13px] text-[#5F6672] dark:text-[#A1A7B3]">
              <Loader2 className="w-5 h-5 animate-spin text-[#0B72E7]" />
              <span>Отрисовка офлайн PDF...</span>
            </div>
          ) : error || !pdfDoc ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-[13.5px] text-red-600 dark:text-red-400">
                {error || 'Не удалось загрузить документ'}
              </p>
              <button
                type="button"
                onClick={handleDownload}
                className="h-9 px-4 rounded-lg bg-[#0B72E7] text-white text-[13px] font-medium"
              >
                Скачать PDF
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              {Array.from({ length: numPages }, (_, idx) => (
                <PdfPageCanvas
                  key={`${bookmark.id}-${bookmark.snapshot_created_at || ''}-${idx + 1}`}
                  pdfDoc={pdfDoc}
                  pageNumber={idx + 1}
                  scale={scale}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
