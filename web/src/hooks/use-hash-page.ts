import { useEffect, useState } from 'react';
import type { AppPageId } from '@/app-modules';

const allowedPages: AppPageId[] = ['sessions', 'workbench', 'settings'];

function parsePage(value: string | null): AppPageId {
  if (value && allowedPages.includes(value as AppPageId)) {
    return value as AppPageId;
  }
  return 'sessions';
}

export function useHashPage() {
  const [page, setPage] = useState<AppPageId>(() => parsePage(window.location.hash.replace('#', '')));

  useEffect(() => {
    const onHashChange = () => {
      setPage(parsePage(window.location.hash.replace('#', '')));
    };

    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (nextPage: AppPageId) => {
    if (nextPage !== page) {
      window.location.hash = nextPage;
    }
  };

  return { page, navigate };
}
