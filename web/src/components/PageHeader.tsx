import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ title, subtitle, breadcrumb, actions }: PageHeaderProps) {
  return (
    <Stack spacing={0.7} sx={{ mb: { xs: 1.4, md: 2 } }}>
      {breadcrumb ? <Box>{breadcrumb}</Box> : null}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        justifyContent="space-between"
        spacing={{ xs: 0.9, md: 1.4 }}
      >
        <Box>
          <Typography variant="h4" sx={{ fontSize: { xs: '1.2rem', md: '1.55rem' } }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.35, maxWidth: 620, lineHeight: 1.55 }}
            >
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        {actions ? <Box sx={{ width: { xs: '100%', md: 'auto' } }}>{actions}</Box> : null}
      </Stack>
    </Stack>
  );
}
