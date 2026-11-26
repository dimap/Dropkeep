import { useRef, useState } from 'react';
import { ImagePlus, Link2, Loader2, Trash2, Upload } from 'lucide-react';
import { api } from '../api';

interface NoteImagePickerProps {
  value: string;
  onChange: (nextUrl: string) => void;
  compact?: boolean;
}

const MAX_CLIENT_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export function NoteImagePicker({ value, onChange, compact = false }: NoteImagePickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [error, setError] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setError('');
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setError('Поддерживаются только PNG, JPEG, WebP и GIF');
      return;
    }
    if (file.size > MAX_CLIENT_IMAGE_BYTES) {
      setError('Файл слишком большой (максимум 5 МБ)');
      return;
    }

    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        if (!dataUrl) {
          throw new Error('Не удалось прочитать файл');
        }
        const res = await api.uploadImage(dataUrl);
        onChange(res.url);
        setShowUrlInput(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось загрузить изображение');
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      setError('Ошибка чтения файла');
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const applyUrlDraft = () => {
    const trimmed = urlDraft.trim();
    setError('');
    if (!trimmed) {
      setShowUrlInput(false);
      return;
    }
    if (!/^https?:\/\/\S+$/i.test(trimmed)) {
      setError('Укажите корректный URL изображения (http:// или https://)');
      return;
    }
    onChange(trimmed);
    setUrlDraft('');
    setShowUrlInput(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3]">
          Изображение (превью карточки)
        </label>
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange('');
              setError('');
            }}
            className="text-[11.5px] text-[#7A828F] hover:text-red-600 dark:hover:text-red-400 inline-flex items-center gap-1 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
            <span>Удалить</span>
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleFileChange}
        className="hidden"
      />

      {value ? (
        <div className="space-y-2">
          <div
            className={`relative rounded-lg overflow-hidden border border-[#E2E5EB] dark:border-[#34373E] bg-[#F4F5F7] dark:bg-[#26282C] ${
              compact ? 'aspect-[16/9]' : 'h-40'
            }`}
          >
            <img
              src={value}
              alt="Превью заметки"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="h-8 px-2.5 rounded-md border border-[#D4DCE6] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[12px] font-medium text-[#2C313A] dark:text-[#E5E7EB] inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors cursor-pointer"
            >
              {uploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span>{uploading ? 'Загрузка...' : 'Заменить файл'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowUrlInput((v) => !v);
                setUrlDraft(value.startsWith('http') ? value : '');
              }}
              className="h-8 px-2.5 rounded-md border border-[#E2E5EB] dark:border-[#34373E] hover:border-[#0B72E7] text-[12px] text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>По ссылке</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="h-9 px-3 rounded-lg border border-dashed border-[#CBD5E1] dark:border-[#424650] hover:border-[#0B72E7] bg-[#F8F9FB] dark:bg-[#26282C] text-[12.5px] font-medium text-[#2C313A] dark:text-[#E5E7EB] inline-flex items-center gap-2 disabled:opacity-50 transition-colors cursor-pointer"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#0B72E7]" />
            ) : (
              <ImagePlus className="w-4 h-4 text-[#0B72E7] dark:text-[#58A6FF]" />
            )}
            <span>{uploading ? 'Загрузка...' : 'Загрузить изображение'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowUrlInput((v) => !v)}
            className="h-9 px-3 rounded-lg border border-[#E2E5EB] dark:border-[#3A3D46] hover:border-[#0B72E7] text-[12.5px] text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>Вставить URL</span>
          </button>
        </div>
      )}

      {showUrlInput && (
        <div className="flex items-center gap-1.5">
          <input
            type="url"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyUrlDraft();
              }
            }}
            placeholder="https://example.com/image.jpg"
            className="flex-1 min-w-0 h-8 px-2.5 rounded-md text-[12.5px] font-mono bg-[#F6F7F9] dark:bg-[#26282C] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
          />
          <button
            type="button"
            onClick={applyUrlDraft}
            className="h-8 px-2.5 rounded-md bg-[#0B72E7] hover:bg-[#0960C5] text-white text-[12px] font-medium shrink-0"
          >
            Ок
          </button>
        </div>
      )}

      {error && (
        <div className="text-[11.5px] text-red-600 dark:text-red-400">{error}</div>
      )}
    </div>
  );
}
