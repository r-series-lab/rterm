import {
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
} from '@mui/material';
import { appModules } from '@/app-modules';
import type { AppPageId } from '@/app-modules';

type ModuleNavigatorProps = {
  activePage: AppPageId;
  onSelectPage: (page: AppPageId) => void;
};

export function ModuleNavigator({ activePage, onSelectPage }: ModuleNavigatorProps) {
  return (
    <Stack spacing={{ xs: 0.8, lg: 0.55 }} sx={{ minHeight: 0 }}>
      <List
        disablePadding
        sx={{
          display: 'flex',
          flexDirection: { xs: 'row', lg: 'column' },
          gap: 0.75,
          overflowX: { xs: 'auto', lg: 'visible' },
          pb: { xs: 0.2, lg: 0 },
        }}
      >
        {appModules.map((module) => {
          const Icon = module.icon;
          const selected = module.id === activePage;

          return (
            <ListItemButton
              key={module.id}
              selected={selected}
              onClick={() => onSelectPage(module.id)}
              sx={{
                minWidth: { xs: 96, sm: 108, lg: 'auto' },
                alignItems: 'center',
                px: { xs: 1, lg: 1.05 },
                py: { xs: 0.78, lg: 0.88 },
                flex: { xs: '0 0 auto', lg: 'initial' },
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: { xs: 24, lg: 28 },
                  color: selected ? 'text.primary' : 'text.secondary',
                }}
              >
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={module.label}
                primaryTypographyProps={{ fontWeight: selected ? 700 : 600, fontSize: '0.96rem' }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Stack>
  );
}
