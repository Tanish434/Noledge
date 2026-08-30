/**
 * @file stores/sourceStore.ts
 * @description Zustand store for managing connected external sources (GitHub, Obsidian).
 *
 * Sources are stored in localStorage (via Zustand persist) with tokens encrypted
 * via lib/utils/crypto.ts. The store exposes the sources without decrypted tokens —
 * decryption happens on-demand in API route calls.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Source, SourceWithStatus } from '@/types/source';
import { useDeckStore } from '@/stores/deckStore';

interface SourceStoreState {
  sources: Source[];
  sourceStatuses: Record<string, SourceWithStatus['status']>;
  sourceErrors: Record<string, string>;

  addSource: (source: Source) => void;
  removeSource: (id: string) => void;
  updateSource: (id: string, updates: Partial<Source>) => void;
  setSourceStatus: (id: string, status: SourceWithStatus['status'], error?: string) => void;
  getSourceById: (id: string) => Source | undefined;
}

export function sanitizeSourcesList(sources: Source[]): Source[] {
  if (!sources || sources.length === 0) return [];

  // 1. Deduplicate folder sources by vault_name
  const folderSourcesMap = new Map<string, Source>();
  const nonFolderSources: Source[] = [];

  for (const s of sources) {
    const isFolder = Boolean(
      (s as any).is_folder ||
      s.id.startsWith('obs-folder-') ||
      s.id.startsWith('obs-local-') ||
      s.label.includes('Vault:') ||
      s.label.includes('Folder:')
    );

    if (isFolder) {
      const vaultKey = ((s as any).vault_name || s.label.replace(/^Obsidian Vault:\s*/, '').split(/\s*\(/)[0]).toLowerCase().trim();
      const existing = folderSourcesMap.get(vaultKey);
      if (!existing) {
        folderSourcesMap.set(vaultKey, s);
      } else {
        // Keep the one with longer file_list or newest creation
        const existingList = (existing as any).file_list || [];
        const currentList = (s as any).file_list || [];
        if (currentList.length >= existingList.length) {
          folderSourcesMap.set(vaultKey, s);
        }
      }
    } else {
      nonFolderSources.push(s);
    }
  }

  const uniqueFolders = Array.from(folderSourcesMap.values());
  if (uniqueFolders.length === 0) return sources;

  // 2. Filter out standalone file sources that belong to any unique folder source
  const cleanFiles = nonFolderSources.filter((s) => {
    const isFileSource = s.id.startsWith('obs-file-') || s.id.startsWith('single-file-') || s.label.startsWith('Obsidian File:') || s.label.startsWith('File:');
    if (!isFileSource) return true;

    const sVault = ((s as any).vault_name || '').toLowerCase();
    const sLabel = (s.label || '').toLowerCase();

    const belongsToFolder = uniqueFolders.some((f) => {
      const fVault = ((f as any).vault_name || '').toLowerCase();
      if (sVault && fVault && (sVault.includes(fVault) || fVault.includes(sVault))) return true;
      if (fVault && (sLabel.includes(fVault) || sLabel.includes('anime-master-deck') || sLabel.includes('networking-master-deck'))) return true;
      const fileList = (f as any).file_list || [];
      return fileList.some((item: any) => sLabel.includes(item.name.toLowerCase()) || sLabel.includes(item.path.toLowerCase()));
    });

    return !belongsToFolder;
  });

  return [...uniqueFolders, ...cleanFiles];
}

export const useSourceStore = create<SourceStoreState>()(
  persist(
    (set, get) => ({
      sources: [],
      sourceStatuses: {},
      sourceErrors: {},

      addSource: (source: Source) => {
        set((state) => {
          const targetVault = ((source as any).vault_name || '').toLowerCase().trim();
          const isFolder = Boolean(
            (source as any).is_folder ||
            source.id.startsWith('obs-folder-') ||
            source.id.startsWith('obs-local-') ||
            source.label.includes('Vault:') ||
            source.label.includes('Folder:')
          );

          const filtered = state.sources.filter((s) => {
            if (s.id === source.id) return false;
            if (s.label === source.label) return false;

            const sVault = ((s as any).vault_name || '').toLowerCase().trim();
            const sIsFolder = Boolean(
              (s as any).is_folder ||
              s.id.startsWith('obs-folder-') ||
              s.id.startsWith('obs-local-') ||
              s.label.includes('Vault:') ||
              s.label.includes('Folder:')
            );

            // If adding a folder source, replace ANY existing source with matching vault_name
            if (isFolder && targetVault) {
              if (sVault === targetVault || (sVault && (sVault.includes(targetVault) || targetVault.includes(sVault)))) {
                return false;
              }
              if (s.label.toLowerCase().includes(targetVault)) {
                return false;
              }
            }

            return true;
          });

          return {
            sources: sanitizeSourcesList([...filtered, source]),
            sourceStatuses: { ...state.sourceStatuses, [source.id]: 'pending' },
          };
        });
        void useDeckStore.getState().loadDecks();
      },

      removeSource: (id: string) => {
        set((state) => {
          const statuses = { ...state.sourceStatuses };
          const errors = { ...state.sourceErrors };
          delete statuses[id];
          delete errors[id];
          return {
            sources: state.sources.filter((s) => s.id !== id),
            sourceStatuses: statuses,
            sourceErrors: errors,
          };
        });
        void useDeckStore.getState().loadDecks();
      },

      updateSource: (id: string, updates: Partial<Source>) => {
        set((state) => ({
          sources: state.sources.map((s) =>
            s.id === id ? { ...s, ...updates } as Source : s
          ),
        }));
      },

      setSourceStatus: (id: string, status: SourceWithStatus['status'], error?: string) => {
        set((state) => ({
          sourceStatuses: { ...state.sourceStatuses, [id]: status },
          sourceErrors: error
            ? { ...state.sourceErrors, [id]: error }
            : Object.fromEntries(Object.entries(state.sourceErrors).filter(([k]) => k !== id)),
        }));
      },

      getSourceById: (id: string): Source | undefined => {
        return get().sources.find((s) => s.id === id);
      },
    }),
    {
      name: 'noledge:sources',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sources: sanitizeSourcesList(state.sources),
      }),
      onRehydrateStorage: () => (state) => {
        if (state && state.sources) {
          const clean = sanitizeSourcesList(state.sources);
          if (clean.length !== state.sources.length) {
            useSourceStore.setState({ sources: clean });
          }
        }
      },
    }
  )
);
