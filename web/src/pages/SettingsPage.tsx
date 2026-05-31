import { Box, Divider, FormControlLabel, Grid, Stack, Switch, TextField } from '@mui/material';
import { PageHeader } from '@/components/PageHeader';
import { SectionCard } from '@/components/SectionCard';
import { useLocalStorageState } from '@/hooks/use-local-storage-state';

const plainInputBehaviorProps = {
  autoCapitalize: 'none',
  autoComplete: 'off',
  autoCorrect: 'off',
  spellCheck: false,
} as const;

export function SettingsPage() {
  const [compactDensity, setCompactDensity] = useLocalStorageState('rterm.settings.compactDensity', false);
  const [showHidden, setShowHidden] = useLocalStorageState('rterm.settings.showHidden', true);
  const [preferChinese, setPreferChinese] = useLocalStorageState('rterm.settings.preferChinese', true);

  return (
    <Box>
      <PageHeader title="设置" />

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={6}>
          <SectionCard title="界面偏好">
            <Stack spacing={0.4}>
              <FormControlLabel
                control={<Switch checked={preferChinese} onChange={(_, checked) => setPreferChinese(checked)} />}
                label="中文优先"
              />
              <FormControlLabel
                control={<Switch checked={compactDensity} onChange={(_, checked) => setCompactDensity(checked)} />}
                label="紧凑布局"
              />
              <FormControlLabel
                control={<Switch checked={showHidden} onChange={(_, checked) => setShowHidden(checked)} />}
                label="显示隐藏文件"
              />
            </Stack>

            <Divider sx={{ my: 1.75 }} />
            <FormControlLabel
              control={<Switch checked disabled />}
              label="保持 r 系列黑白灰基调"
            />
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <SectionCard title="默认连接">
            <Box component="form" sx={{ display: 'grid', gap: 2 }}>
              <TextField label="默认主机" placeholder="files.internal" inputProps={plainInputBehaviorProps} fullWidth />
              <TextField label="默认远程路径" placeholder="/srv/releases/current" inputProps={plainInputBehaviorProps} fullWidth />
              <TextField label="身份配置" placeholder="ops-primary" inputProps={plainInputBehaviorProps} fullWidth />
            </Box>
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
