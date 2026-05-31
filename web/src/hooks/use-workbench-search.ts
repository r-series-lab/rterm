import { useCallback, useRef, useState } from 'react';
import { cancelSearch as cancelRuntimeSearch, searchEntries } from '@/lib/rterm-runtime';
import type {
  BrowseEntry,
  ConnectionDraft,
  FileMutationScope,
  RuntimeMode,
  SearchMode,
  SearchResultData,
  SearchTextMatch,
} from '@/lib/rterm-types';

export type PendingSearch = {
  scope: FileMutationScope;
  directory: string;
  targets: BrowseEntry[];
  mode: SearchMode;
  result: SearchResultData | null;
  runtimeMode: RuntimeMode | null;
};

type UseWorkbenchSearchOptions = {
  activeConnection: ConnectionDraft | null;
  showHiddenFiles: boolean;
  ignorePatterns: string[];
  onError: (message: string) => void;
};

export function useWorkbenchSearch({
  activeConnection,
  showHiddenFiles,
  ignorePatterns,
  onError,
}: UseWorkbenchSearchOptions) {
  const [pendingSearch, setPendingSearch] = useState<PendingSearch | null>(null);
  const [searchQueryValue, setSearchQueryValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const activeSearchIdRef = useRef<string | null>(null);

  const openSearchDialog = useCallback(
    (scope: FileMutationScope, directory: string, targets: BrowseEntry[] = [], mode: SearchMode = 'content') => {
      const searchId = activeSearchIdRef.current;
      activeSearchIdRef.current = null;
      setIsSearching(false);

      if (searchId) {
        void cancelRuntimeSearch(searchId).catch(() => {
          // Cancellation is best-effort; the incoming search dialog owns the UI now.
        });
      }

      setSearchQueryValue('');
      setPendingSearch({
        scope,
        directory,
        targets,
        mode,
        result: null,
        runtimeMode: null,
      });
    },
    [],
  );

  const cancelRunningSearch = useCallback(() => {
    const searchId = activeSearchIdRef.current;
    activeSearchIdRef.current = null;
    setIsSearching(false);

    if (searchId) {
      void cancelRuntimeSearch(searchId).catch(() => {
        // Cancellation is best-effort; the UI has already dropped the pending result.
      });
    }
  }, []);

  const clearSearch = useCallback(() => {
    activeSearchIdRef.current = null;
    setPendingSearch(null);
    setSearchQueryValue('');
    setIsSearching(false);
  }, []);

  const dismissSearch = useCallback(() => {
    if (isSearching) {
      cancelRunningSearch();
    }

    setPendingSearch(null);
    setSearchQueryValue('');
  }, [cancelRunningSearch, isSearching]);

  const runSearch = useCallback(async () => {
    if (!pendingSearch || !activeConnection) {
      return;
    }

    const query = searchQueryValue.trim();
    if (!query) {
      return;
    }

    setIsSearching(true);
    const searchId = createSearchId();
    activeSearchIdRef.current = searchId;

    try {
      const targetPaths = pendingSearch.targets.map((target) => target.path);
      const result = await searchEntries(
        activeConnection,
        pendingSearch.scope,
        pendingSearch.directory,
        query,
        pendingSearch.mode,
        showHiddenFiles,
        200,
        targetPaths.length > 0 ? targetPaths : undefined,
        searchId,
        ignorePatterns,
      );
      if (activeSearchIdRef.current !== searchId) {
        return;
      }

      setPendingSearch((current) =>
        current
          ? {
              ...current,
              result: result.data,
              runtimeMode: result.runtimeMode,
            }
          : current,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (
        activeSearchIdRef.current !== searchId ||
        detail.includes('搜索已取消') ||
        detail.includes('search cancelled')
      ) {
        return;
      }

      onError(error instanceof Error ? error.message : '未能完成递归搜索。');
    } finally {
      if (activeSearchIdRef.current === searchId) {
        activeSearchIdRef.current = null;
        setIsSearching(false);
      }
    }
  }, [activeConnection, ignorePatterns, onError, pendingSearch, searchQueryValue, showHiddenFiles]);

  return {
    pendingSearch,
    setPendingSearch,
    searchQueryValue,
    setSearchQueryValue,
    isSearching,
    openSearchDialog,
    cancelRunningSearch,
    clearSearch,
    dismissSearch,
    runSearch,
  };
}

export function searchMatchDisplayPath(match: SearchTextMatch): string {
  return match.archivePath ? `${match.entry.path}!/${match.archivePath}` : match.entry.path;
}

export function searchMatchDisplayName(match: SearchTextMatch): string {
  if (!match.archivePath) {
    return match.entry.name;
  }

  const lastSegment = match.archivePath.split('/').pop() ?? match.archivePath;
  return lastSegment.split('!/').pop() ?? lastSegment;
}

export function isArchiveSearchTarget(entry: BrowseEntry): boolean {
  const lowered = entry.name.toLowerCase();
  return (
    lowered.endsWith('.tar.gz') ||
    lowered.endsWith('.tgz') ||
    lowered.endsWith('.tar') ||
    lowered.endsWith('.zip')
  );
}

export function searchDialogTitle(search: PendingSearch | null): string {
  if (!search) {
    return '搜索';
  }

  if (search.targets.length > 1) {
    return `在已选 ${search.targets.length} 项中搜索`;
  }

  const target = search.targets[0];
  if (!target) {
    return search.mode === 'content' ? `搜索${scopeLabel(search.scope)}文件内容` : `搜索${scopeLabel(search.scope)}`;
  }

  if (target.kind === 'directory') {
    return '在此文件夹中搜索';
  }

  return isArchiveSearchTarget(target) ? '在压缩包中搜索' : '在此文件中搜索';
}

export function searchDialogSubtitle(search: PendingSearch | null): string {
  if (!search) {
    return '';
  }

  if (search.targets.length === 0) {
    return search.directory;
  }

  if (search.targets.length === 1) {
    return search.targets[0].path;
  }

  const names = search.targets.slice(0, 3).map((target) => target.name).join('、');
  return search.targets.length > 3 ? `${names} 等 ${search.targets.length} 项` : names;
}

function createSearchId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function scopeLabel(scope: FileMutationScope): string {
  return scope === 'local' ? '本地' : '远端';
}
