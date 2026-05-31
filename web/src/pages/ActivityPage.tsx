import { Box, Chip, Stack, Typography } from '@mui/material';
import { PageHeader } from '@/components/PageHeader';
import { SectionCard } from '@/components/SectionCard';
import { timeline } from '@/lib/rterm-data';

const toneLabel = {
  info: '信息',
  success: '完成',
  warning: '提醒',
  error: '异常',
} as const;

export function ActivityPage() {
  return (
    <Box>
      <PageHeader title="活动" />

      <SectionCard title="最近记录">
        <Stack spacing={2}>
          {timeline.map((event) => (
            <Box
              key={event.id}
              sx={{
                display: 'grid',
                gridTemplateColumns: '72px 1fr',
                gap: 2,
                alignItems: 'start',
                pb: 1.75,
                borderBottom: (theme) =>
                  event.id === timeline[timeline.length - 1]?.id ? 'none' : `1px solid ${theme.palette.divider}`,
              }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ pt: 0.5 }}>
                {event.time}
              </Typography>
              <Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                  <Chip label={toneLabel[event.tone]} size="small" variant="outlined" />
                  <Typography variant="subtitle2">{event.title}</Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                  {event.detail}
                </Typography>
              </Box>
            </Box>
          ))}
        </Stack>
      </SectionCard>
    </Box>
  );
}
