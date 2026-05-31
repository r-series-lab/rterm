import type { ReactNode } from 'react';
import { Box, Card, CardContent, Stack, Typography } from '@mui/material';

type SectionCardProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  compact?: boolean;
  children: ReactNode;
};

export function SectionCard({ title, subtitle, actions, compact = false, children }: SectionCardProps) {
  return (
    <Card
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: 'var(--rterm-surface)',
        backgroundImage: 'var(--rterm-panel-bg)',
        borderColor: 'var(--rterm-panel-border)',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          width: 120,
          height: '1px',
          backgroundColor: 'var(--rterm-accent)',
          opacity: 0.32,
          pointerEvents: 'none',
        },
      }}
    >
      <CardContent
        sx={{
          p: compact ? { xs: 1, md: 1.18 } : { xs: 1.35, md: 1.8 },
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          '&:last-child': {
            pb: compact ? { xs: 1, md: 1.18 } : { xs: 1.35, md: 1.8 },
          },
        }}
      >
        <Stack spacing={compact ? 0.88 : 1.35} sx={{ height: '100%', minHeight: 0 }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={compact ? 0.48 : 0.8}
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            justifyContent="space-between"
          >
            <Stack spacing={0.35}>
              <Typography variant={compact ? 'subtitle2' : 'h6'}>{title}</Typography>
              {subtitle ? (
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                  {subtitle}
                </Typography>
              ) : null}
            </Stack>
            {actions ? <Box sx={{ width: { xs: '100%', sm: 'auto' } }}>{actions}</Box> : null}
          </Stack>
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}
