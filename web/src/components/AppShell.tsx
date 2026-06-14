import type { ReactNode } from 'react';
import { Box } from '@mui/material';

type AppShellProps = {
  sidebar?: ReactNode;
  children: ReactNode;
};

export function AppShell({ sidebar, children }: AppShellProps) {
  const hasSidebar = Boolean(sidebar);

  return (
    <Box
      sx={{
        height: '100vh',
        minHeight: '100vh',
        overflow: 'hidden',
        color: 'text.primary',
        backgroundColor: 'var(--rterm-app-bg)',
        backgroundImage: 'var(--rterm-app-bg-image)',
        pt: 'var(--window-drag-height)',
        position: 'relative',
      }}
    >
      <Box className="window-drag-region" data-tauri-drag-region />
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: hasSidebar ? { xs: '1fr', lg: '176px minmax(0, 1fr)' } : '1fr',
          height: '100%',
          minHeight: 0,
        }}
      >
        {hasSidebar ? (
          <Box
            sx={{
              borderRight: { lg: (theme) => `1px solid ${theme.palette.divider}` },
              p: { xs: 0.88, lg: 1.28 },
              minHeight: 0,
            }}
          >
            {sidebar}
          </Box>
        ) : null}
        <Box
          sx={{
            p: { xs: 0.28, sm: 0.36, md: 0.48 },
            minHeight: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box
            sx={{
              width: '100%',
              height: '100%',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {children}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
