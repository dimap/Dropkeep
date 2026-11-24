import { useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../api';
import type { Collection } from '../types';
import {
  COLLECTION_COLORS,
  COLLECTION_EMOJIS,
  COLLECTION_ICONS,
  CollectionIconView,
  extractFirstGrapheme,
  isEmojiCollectionIcon,
} from '../utils/icons';

interface CollectionModalProps {
  collections: Collection[];
  editingCollection: Collection | null;
  defaultParentId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function CollectionModal({
  collections,
  editingCollection,
  defaultParentId,
  onClose,
  onSaved,
}: CollectionModalProps) {
  const initialIcon = editingCollection?.icon || 'folder';
  const [title, setTitle] = useState(editingCollection?.title || '');
  const [parentId, setParentId] = useState<string>(
    editingCollection ? editingCollection.parent_id || '' : defaultParentId || ''
  );
  const [icon, setIcon] = useState(initialIcon);
  const [iconTab, setIconTab] = useState<'icons' | 'emoji'>(() =>
    isEmojiCollectionIcon(initialIcon) ? 'emoji' : 'icons'
  );
  const [customEmoji, setCustomEmoji] = useState(() =>
    isEmojiCollectionIcon(initialIcon) ? initialIcon : ''
  );
  const [color, setColor] = useState(editingCollection?.color || '#0B72E7');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const availableParents = collections.filter((c) => c.id !== editingCollection?.id);

  const handleCustomEmojiChange = (raw: string) => {
    const grapheme = extractFirstGrapheme(raw);
    setCustomEmoji(grapheme);
    if (grapheme) {
      setIcon(grapheme);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Введите название коллекции');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const finalIcon = icon.trim() || 'folder';
      if (editingCollection) {
        await api.updateCollection(editingCollection.id, {
          title: title.trim(),
          parent_id: parentId || null,
          icon: finalIcon,
          color,
        });
      } else {
        await api.createCollection({
          title: title.trim(),
          parent_id: parentId || null,
          icon: finalIcon,
          color,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения коллекции');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] max-h-[90vh] flex flex-col rounded-xl bg-white dark:bg-[#222429] border border-[#E6E8EC] dark:border-[#34373E] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-[#E6E8EC] dark:border-[#30333A] flex items-center justify-between shrink-0">
          <h2 className="text-[15px] font-semibold text-[#181A1F] dark:text-[#F1F3F5]">
            {editingCollection ? 'Редактировать коллекцию' : 'Новая коллекция'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-8 h-8 rounded-md flex items-center justify-center text-[#8B929E] hover:bg-[#F4F5F7] dark:hover:bg-[#30333A]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {error && (
            <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[12.5px] text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1">
              Название
            </label>
            <div className="flex items-center gap-2">
              <div
                title="Текущая иконка"
                className="w-9 h-9 rounded-lg bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] flex items-center justify-center shrink-0"
              >
                <CollectionIconView icon={icon} color={color} className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Например: Docker и серверы"
                autoFocus
                className="flex-1 min-w-0 h-9 px-3 rounded-lg text-[13.5px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3] mb-1">
              Родительская коллекция
            </label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full h-9 px-2.5 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
            >
              <option value="">Корневой уровень</option>
              {availableParents.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parent_id ? '↳ ' : ''}
                  {c.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <label className="text-[12px] font-medium text-[#5F6672] dark:text-[#A1A7B3]">
                Иконка папки
              </label>
              <div className="inline-flex rounded-md bg-[#F1F3F6] dark:bg-[#2B2D33] p-0.5 text-[11.5px] font-medium">
                <button
                  type="button"
                  onClick={() => setIconTab('icons')}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    iconTab === 'icons'
                      ? 'bg-white dark:bg-[#3A3D46] text-[#181A1F] dark:text-white shadow-2xs'
                      : 'text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white'
                  }`}
                >
                  Иконки
                </button>
                <button
                  type="button"
                  onClick={() => setIconTab('emoji')}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    iconTab === 'emoji'
                      ? 'bg-white dark:bg-[#3A3D46] text-[#181A1F] dark:text-white shadow-2xs'
                      : 'text-[#5F6672] dark:text-[#A1A7B3] hover:text-[#181A1F] dark:hover:text-white'
                  }`}
                >
                  Эмодзи
                </button>
              </div>
            </div>

            {iconTab === 'icons' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  {COLLECTION_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      aria-label={`Цвет ${c}`}
                      className={`w-5 h-5 rounded-full transition-transform ${
                        color === c ? 'ring-2 ring-offset-2 ring-[#0B72E7] dark:ring-offset-[#222429] scale-110' : ''
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>

                <div className="grid grid-cols-10 gap-1">
                  {Object.entries(COLLECTION_ICONS).map(([key, item]) => {
                    const Icon = item.icon;
                    const active = icon === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        title={item.label}
                        onClick={() => setIcon(key)}
                        className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                          active
                            ? 'bg-[#EDF4FE] dark:bg-[#192B44] ring-1 ring-[#0B72E7]'
                            : 'hover:bg-[#F3F4F6] dark:hover:bg-[#30333A] text-[#5F6672] dark:text-[#A1A7B3]'
                        }`}
                      >
                        <Icon className="w-4 h-4" style={active ? { color } : undefined} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customEmoji}
                    onChange={(e) => handleCustomEmojiChange(e.target.value)}
                    placeholder="Вставьте любой эмодзи (например 🦊)"
                    className="flex-1 min-w-0 h-8 px-2.5 rounded-lg text-[13px] bg-[#F6F7F9] dark:bg-[#2B2D33] border border-[#E2E5EB] dark:border-[#3A3D46] focus:border-[#0B72E7] focus:outline-none"
                  />
                  {customEmoji && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomEmoji('');
                        setIcon('folder');
                      }}
                      className="h-8 px-2.5 rounded-lg text-[12px] text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#F3F4F6] dark:hover:bg-[#30333A]"
                    >
                      Сбросить
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-10 gap-1">
                  {COLLECTION_EMOJIS.map((em) => {
                    const active = icon === em;
                    return (
                      <button
                        key={em}
                        type="button"
                        onClick={() => {
                          setIcon(em);
                          setCustomEmoji(em);
                        }}
                        className={`w-8 h-8 rounded-md flex items-center justify-center text-[16px] leading-none transition-colors ${
                          active
                            ? 'bg-[#EDF4FE] dark:bg-[#192B44] ring-1 ring-[#0B72E7]'
                            : 'hover:bg-[#F3F4F6] dark:hover:bg-[#30333A]'
                        }`}
                      >
                        {em}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[#ECEEF2] dark:border-[#30333A]">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-3.5 rounded-lg text-[13px] font-medium text-[#5F6672] dark:text-[#A1A7B3] hover:bg-[#F3F4F6] dark:hover:bg-[#30333A]"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-9 px-4 rounded-lg bg-[#0B72E7] hover:bg-[#0960C5] disabled:opacity-60 text-white text-[13px] font-medium"
            >
              {saving ? 'Сохранение...' : editingCollection ? 'Сохранить' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
