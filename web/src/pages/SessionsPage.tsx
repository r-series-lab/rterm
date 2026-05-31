import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloudQueueRoundedIcon from '@mui/icons-material/CloudQueueRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
import {
  Box,
  Button,
  Divider,
  Grid,
  IconButton,
  InputBase,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import type { Theme } from '@mui/material/styles';
import { useRef, useState, type ChangeEvent as ReactChangeEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { PageHeader } from '@/components/PageHeader';
import type {
  ConnectionDraft,
  ConnectionTestResult,
  FavoriteItem,
  RuntimeMode,
  TerminalProfile,
} from '@/lib/rterm-types';

const filterDirectoryOptions = createFilterOptions<string>();

const defaultPortByProtocol: Record<ConnectionDraft['protocol'], string> = {
  SFTP: '22',
  SCP: '22',
  FTP: '21',
  FTPS: '990',
  WebDAV: '443',
};

const protocolOptions: ConnectionDraft['protocol'][] = ['SFTP', 'SCP', 'FTP', 'FTPS', 'WebDAV'];
const terminalProfileOptions: Array<{ value: TerminalProfile; label: string }> = [
  { value: 'auto', label: '自动 / POSIX' },
  { value: 'posix', label: 'POSIX' },
  { value: 'bash', label: 'Bash' },
  { value: 'zsh', label: 'Zsh' },
  { value: 'fish', label: 'Fish' },
  { value: 'powershell', label: 'PowerShell' },
  { value: 'cmd', label: 'CMD' },
];

const noTextTransformInputProps = {
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: false,
} as const;

const plainInputBehaviorProps = {
  ...noTextTransformInputProps,
  autoComplete: 'off',
} as const;

function connectionEndpoint(host: string, port?: number | string | null) {
  return port ? `${host}:${port}` : host;
}

function normalizeDirectoryPath(value?: string | null) {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) {
    return '';
  }

  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return `/${trimmed.replaceAll('\\', '/')}`;
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function uniqueDirectoryOptions(paths: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return paths
    .map((path) => normalizeDirectoryPath(path))
    .filter((path) => {
      if (!path || seen.has(path)) {
        return false;
      }

      seen.add(path);
      return true;
    });
}

function draftDirectoryOptions(draft: ConnectionDraft) {
  return uniqueDirectoryOptions([draft.path, ...(draft.paths ?? [])]);
}

function favoriteMatchesDraft(favorite: FavoriteItem, draft: ConnectionDraft) {
  const draftPort = draft.port?.trim() || '';
  const favoritePort = favorite.port == null ? '' : String(favorite.port);
  const draftPaths = draftDirectoryOptions(draft);
  const favoritePaths = uniqueDirectoryOptions([favorite.path, ...(favorite.paths ?? [])]);

  return (
    favorite.protocol === draft.protocol &&
    favorite.host === draft.host.trim() &&
    favoritePaths.some((path) => draftPaths.includes(path)) &&
    favoritePort === draftPort &&
    Boolean(favorite.legacySshHostKeyAlgorithms) === Boolean(draft.legacySshHostKeyAlgorithms)
  );
}

type SessionsPageProps = {
  embedded?: boolean;
  draft: ConnectionDraft;
  favorites: FavoriteItem[];
  notice: { tone: 'success' | 'error' | 'info'; title: string; detail?: string } | null;
  connectionResult: ConnectionTestResult | null;
  runtimeMode: RuntimeMode;
  isTesting: boolean;
  isOpeningWorkbench: boolean;
  openingConnectionId: string | null;
  isSavingFavorite: boolean;
  onDraftChange: (draft: ConnectionDraft) => void;
  onNewDraft: () => void;
  onSelectFavorite: (favorite: FavoriteItem) => void;
  onOpenFavorite: (favorite: FavoriteItem) => void;
  onSaveDraftFavorite: () => void;
  onRemoveFavorite: (favoriteId: string) => void;
  onRenameFavorite: (favoriteId: string, name: string) => void;
  onImportFavorites: (content: string) => void;
  onExportFavorites: () => void;
  onTestConnection: () => void;
  onOpenWorkbench: () => void;
};

const toneStyles = {
  success: {
    borderColor: 'rgba(180, 241, 214, 0.18)',
    backgroundColor: 'rgba(180, 241, 214, 0.06)',
  },
  error: {
    borderColor: 'rgba(255, 178, 178, 0.18)',
    backgroundColor: 'rgba(255, 178, 178, 0.06)',
  },
  info: {
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
} as const;

const denseFieldSx = {
  '& .MuiOutlinedInput-root': {
    minHeight: 38,
    borderRadius: '11px',
    backgroundColor: (theme: Theme) =>
      theme.palette.mode === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.018)',
  },
  '& .MuiInputBase-input': {
    py: 0.72,
    fontSize: '0.82rem',
  },
  '& .MuiInputLabel-root': {
    fontSize: '0.78rem',
  },
  '& .MuiFormHelperText-root': {
    mt: 0.18,
    fontSize: '0.65rem',
  },
};

const actionButtonSx = {
  minHeight: 34,
  borderRadius: '11px',
  fontSize: '0.82rem',
};

const headerIconButtonSx = {
  width: 28,
  height: 28,
  border: (theme: Theme) => `1px solid ${theme.palette.divider}`,
  color: 'text.secondary',
  backgroundColor: (theme: Theme) =>
    theme.palette.mode === 'light' ? 'rgba(31,34,39,0.035)' : 'rgba(255,255,255,0.024)',
  '&:hover': {
    color: 'text.primary',
  },
};

type FavoriteActionMenuState = {
  item: FavoriteItem;
  anchorEl: HTMLElement;
};

function EmptyHostsArt() {
  return (
    <Box
      component="svg"
      viewBox="0 0 132 96"
      aria-hidden="true"
      sx={{
        width: 126,
        height: 92,
        color: 'text.secondary',
        opacity: 0.36,
      }}
    >
      <path
        d="M30 31h27l7 8h39v29H30Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M42 48h24M42 58h17"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.42"
      />
      <path
        d="M84 48v14M77 55h14"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.62"
      />
      <path d="M39 78h58" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.16" />
    </Box>
  );
}

export function SessionsPage({
  embedded = false,
  draft,
  favorites,
  notice,
  connectionResult,
  runtimeMode,
  isTesting,
  isOpeningWorkbench,
  openingConnectionId,
  isSavingFavorite,
  onDraftChange,
  onNewDraft,
  onSelectFavorite,
  onOpenFavorite,
  onSaveDraftFavorite,
  onRemoveFavorite,
  onRenameFavorite,
  onImportFavorites,
  onExportFavorites,
  onTestConnection,
  onOpenWorkbench,
}: SessionsPageProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [actionMenu, setActionMenu] = useState<FavoriteActionMenuState | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const port = draft.port?.trim();
  const hasValidPort = !port || (/^\d+$/.test(port) && Number(port) > 0 && Number(port) <= 65535);
  const canSubmit = draft.host.trim().length > 0 && hasValidPort;
  const selectedFavorite = favorites.find((favorite) => favoriteMatchesDraft(favorite, draft)) ?? null;
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredFavorites = favorites.filter((favorite) => {
    if (!normalizedSearch) {
      return true;
    }

    return [favorite.name, favorite.host, favorite.username, favorite.path, ...(favorite.paths ?? []), favorite.protocol]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalizedSearch));
  });
  const formTitle = selectedFavorite ? selectedFavorite.name : draft.name?.trim() || '新增配置';
  const directoryOptions = draftDirectoryOptions(draft);
  const selectedDirectory = normalizeDirectoryPath(draft.path) || directoryOptions[0] || '';

  const commitDirectoryOptions = (paths: string[], selectedPath: string) => {
    const nextPaths = uniqueDirectoryOptions(paths);
    const nextPath = normalizeDirectoryPath(selectedPath) || nextPaths[0] || '';
    onDraftChange({
      ...draft,
      path: nextPath,
      paths: nextPaths,
    });
  };

  const handleCommitDirectory = (value: string | null) => {
    const normalized = normalizeDirectoryPath(value);
    if (!normalized) {
      return;
    }

    commitDirectoryOptions([...directoryOptions, normalized], normalized);
  };

  const handleRemoveDirectory = (pathToRemove: string) => {
    const normalized = normalizeDirectoryPath(pathToRemove);
    if (!normalized) {
      return;
    }

    const nextPaths = directoryOptions.filter((path) => path !== normalized);
    const nextSelectedPath = selectedDirectory === normalized ? nextPaths[0] ?? '' : selectedDirectory;
    commitDirectoryOptions(nextPaths, nextSelectedPath);
  };

  const openFavoriteMenu = (event: ReactMouseEvent<HTMLElement>, item: FavoriteItem) => {
    event.stopPropagation();
    setActionMenu({
      item,
      anchorEl: event.currentTarget,
    });
  };

  const closeActionMenu = () => {
    setActionMenu(null);
  };

  const handleRenameFavoriteFromMenu = (item: FavoriteItem) => {
    const nextName = window.prompt('重命名配置', item.name);
    if (!nextName) {
      return;
    }

    const normalized = nextName.trim();
    if (!normalized || normalized === item.name) {
      return;
    }

    onRenameFavorite(item.id, normalized);
  };

  const handleRemoveFavoriteFromMenu = (item: FavoriteItem) => {
    onRemoveFavorite(item.id);
  };

  const handleImportFile = async (event: ReactChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    onImportFavorites(await file.text());
  };

  return (
    <Box
      sx={{
        width: '100%',
        height: 'auto',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'visible',
      }}
    >
      {!embedded ? <PageHeader title="连接" /> : null}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: embedded ? '200px minmax(0, 1fr)' : '252px minmax(0, 1fr)' },
          gap: embedded ? 0.62 : 1.2,
          alignItems: 'stretch',
          height: 'auto',
          minHeight: 0,
          overflow: 'visible',
        }}
      >
        <Box
          sx={{
            minHeight: 0,
            borderRadius: '14px',
            border: (theme) => `1px solid ${theme.palette.divider}`,
            background: (theme) =>
              theme.palette.mode === 'light'
                ? 'linear-gradient(180deg, rgba(255,255,255,0.86), rgba(247,243,236,0.76))'
                : 'linear-gradient(180deg, rgba(255,255,255,0.032), rgba(255,255,255,0.014))',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            height: 'auto',
            maxHeight: embedded ? { xs: 300, md: 'min(58vh, 430px)' } : undefined,
          }}
        >
          <Stack
            direction="row"
            spacing={0.7}
            alignItems="center"
            justifyContent="space-between"
            sx={{ px: 0.72, py: 0.55, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}
          >
            <Stack spacing={0.08}>
              <Typography variant="subtitle2" fontWeight={700}>
                主机
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.34} alignItems="center">
              <input
                ref={importInputRef}
                hidden
                type="file"
                accept="application/json,.json"
                onChange={(event) => void handleImportFile(event)}
              />
              <Tooltip title="新增配置">
                <IconButton
                  size="small"
                  onClick={onNewDraft}
                  sx={{
                    ...headerIconButtonSx,
                    color: 'text.primary',
                    backgroundColor: (theme) =>
                      theme.palette.mode === 'light' ? 'rgba(32,34,38,0.045)' : 'rgba(255,255,255,0.035)',
                  }}
                >
                  <AddRoundedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="导入配置">
                <span>
                  <IconButton
                    size="small"
                    disabled={isSavingFavorite || isTesting || isOpeningWorkbench}
                    onClick={() => importInputRef.current?.click()}
                    sx={headerIconButtonSx}
                  >
                    <FileUploadRoundedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="导出配置">
                <span>
                  <IconButton
                    size="small"
                    disabled={favorites.length === 0}
                    onClick={onExportFavorites}
                    sx={headerIconButtonSx}
                  >
                    <FileDownloadRoundedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Stack>

          <Box sx={{ px: 0.52, py: 0.42 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                height: 30,
                px: 0.62,
                borderRadius: '9px',
                border: (theme) => `1px solid ${theme.palette.divider}`,
                background: (theme) =>
                  theme.palette.mode === 'light'
                    ? 'linear-gradient(180deg, rgba(255,255,255,0.9), rgba(247,243,236,0.72))'
                    : 'linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.012))',
                boxShadow: (theme) =>
                  theme.palette.mode === 'light'
                    ? 'inset 0 1px 2px rgba(31,34,39,0.06)'
                    : 'inset 0 1px 0 rgba(255,255,255,0.025)',
              }}
            >
              <SearchRoundedIcon sx={{ fontSize: 14, color: 'text.secondary', opacity: 0.76 }} />
              <InputBase
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="搜索配置"
                inputProps={plainInputBehaviorProps}
                sx={{
                  '&&': {
                    backgroundColor: 'transparent',
                  },
                  flex: 1,
                  minWidth: 0,
                  color: 'text.primary',
                  fontSize: '0.76rem',
                  '& .MuiInputBase-input': {
                    py: 0,
                  },
                  '& input::placeholder': {
                    color: (theme) =>
                      theme.palette.mode === 'light' ? 'rgba(29,32,38,0.46)' : 'rgba(255,255,255,0.42)',
                    opacity: 1,
                  },
                }}
              />
            </Box>
          </Box>

          <Stack
            spacing={0.34}
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              px: 0.48,
              pb: 0.6,
              scrollbarWidth: 'thin',
              scrollbarColor: (theme) =>
                theme.palette.mode === 'light'
                  ? 'rgba(31,34,39,0.24) rgba(31,34,39,0.04)'
                  : 'rgba(255,255,255,0.22) rgba(255,255,255,0.035)',
              '&::-webkit-scrollbar': {
                width: 7,
              },
              '&::-webkit-scrollbar-thumb': {
                borderRadius: 999,
                backgroundColor: (theme) =>
                  theme.palette.mode === 'light' ? 'rgba(31,34,39,0.24)' : 'rgba(255,255,255,0.22)',
              },
              '&::-webkit-scrollbar-track': {
                backgroundColor: (theme) =>
                  theme.palette.mode === 'light' ? 'rgba(31,34,39,0.04)' : 'rgba(255,255,255,0.035)',
              },
            }}
          >
            {filteredFavorites.length > 0 ? (
              filteredFavorites.map((item) => {
                const isSelected = selectedFavorite?.id === item.id;
                const isOpening = isOpeningWorkbench && openingConnectionId === `favorite:${item.id}`;

                return (
                  <Box
                    key={item.id}
                    onClick={() => onSelectFavorite(item)}
                    onDoubleClick={() => !isOpeningWorkbench && !isTesting && onOpenFavorite(item)}
                    sx={{
                      px: 0.58,
                      py: 0.46,
                      borderRadius: '10px',
                      border: (theme) =>
                        `1px solid ${
                          isSelected
                            ? theme.palette.mode === 'light'
                              ? 'rgba(32,34,38,0.24)'
                              : 'rgba(245,243,238,0.2)'
                            : theme.palette.divider
                        }`,
                      backgroundColor: (theme) =>
                        isSelected
                          ? theme.palette.mode === 'light'
                            ? 'rgba(32,34,38,0.06)'
                            : 'rgba(255,255,255,0.07)'
                          : theme.palette.mode === 'light'
                            ? 'rgba(255,255,255,0.42)'
                            : 'rgba(255,255,255,0.012)',
                      cursor: 'pointer',
                      transition: 'border-color 120ms ease, background-color 120ms ease',
                      '&:hover': {
                        borderColor: (theme) =>
                          theme.palette.mode === 'light' ? 'rgba(32,34,38,0.22)' : 'rgba(255,255,255,0.13)',
                        backgroundColor: (theme) =>
                          isSelected
                            ? theme.palette.mode === 'light'
                              ? 'rgba(32,34,38,0.075)'
                              : 'rgba(255,255,255,0.08)'
                            : theme.palette.mode === 'light'
                              ? 'rgba(32,34,38,0.045)'
                              : 'rgba(255,255,255,0.03)',
                      },
                    }}
                  >
                    <Stack direction="row" spacing={0.65} alignItems="center" sx={{ minWidth: 0 }}>
                      <Box
                        sx={{
                          width: 24,
                          height: 24,
                          borderRadius: '9px',
                          border: '1px solid rgba(255,255,255,0.08)',
                          backgroundColor: isSelected ? 'rgba(245,243,238,0.12)' : 'rgba(255,255,255,0.028)',
                          display: 'grid',
                          placeItems: 'center',
                          color: isSelected ? 'text.primary' : 'text.secondary',
                          flexShrink: 0,
                        }}
                      >
                        <CloudQueueRoundedIcon sx={{ fontSize: 15 }} />
                      </Box>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={0.42} alignItems="center" sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={700} noWrap sx={{ minWidth: 0 }}>
                            {item.name}
                          </Typography>
                          {isOpening ? (
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.62rem' }}>
                              连接中
                            </Typography>
                          ) : null}
                        </Stack>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                          sx={{ display: 'block', mt: 0.12, fontSize: '0.66rem', opacity: 0.75 }}
                        >
                          {item.protocol} · {item.username ? `${item.username}@` : ''}
                          {connectionEndpoint(item.host, item.port)}
                        </Typography>
                      </Box>
                      <IconButton
                        size="small"
                        onClick={(event) => openFavoriteMenu(event, item)}
                        sx={{ width: 24, height: 24, color: 'text.secondary', flexShrink: 0 }}
                      >
                        <MoreHorizRoundedIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Stack>
                  </Box>
                );
              })
            ) : (
              <Box
                sx={{
                  minHeight: 178,
                  borderRadius: '12px',
                  display: 'grid',
                  placeItems: 'center',
                  background: (theme) =>
                    theme.palette.mode === 'light'
                      ? 'linear-gradient(180deg, rgba(31,34,39,0.025), rgba(31,34,39,0.01))'
                      : 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.006))',
                }}
              >
                <EmptyHostsArt />
              </Box>
            )}
          </Stack>
        </Box>

        <Box
          sx={{
            minHeight: 0,
            borderRadius: '14px',
            border: (theme) => `1px solid ${theme.palette.divider}`,
            background: (theme) =>
              theme.palette.mode === 'light'
                ? 'radial-gradient(circle at 20% 0%, rgba(255,255,255,0.94), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.86), rgba(247,243,236,0.76))'
                : 'radial-gradient(circle at 20% 0%, rgba(255,255,255,0.045), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.012))',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            alignSelf: 'stretch',
            height: 'auto',
          }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={0.7}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            justifyContent="space-between"
            sx={{ px: 0.9, py: 0.68, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}
          >
            <Stack spacing={0.12} sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={0.62} alignItems="center" sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" fontWeight={700} noWrap>
                  {formTitle}
                </Typography>
              </Stack>
            </Stack>
          </Stack>

          <Stack
            spacing={0.88}
            sx={{
              flex: '0 0 auto',
              minHeight: 0,
              overflow: 'visible',
              p: { xs: 0.82, md: 0.92 },
            }}
          >
            <Grid container spacing={0.86}>
              <Grid item xs={12}>
                <TextField
                  size="small"
                  label="主机名"
                  placeholder="常用 · Windows"
                  value={draft.name ?? ''}
                  onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
                  inputProps={plainInputBehaviorProps}
                  sx={denseFieldSx}
                  fullWidth
                />
              </Grid>
              <Grid item xs={7}>
                <TextField
                  size="small"
                  select
                  label="协议"
                  value={draft.protocol}
                  onChange={(event) => {
                    const nextProtocol = event.target.value as ConnectionDraft['protocol'];
                    const currentPort = draft.port?.trim();
                    const shouldUseDefaultPort =
                      !currentPort || currentPort === defaultPortByProtocol[draft.protocol];

                    onDraftChange({
                      ...draft,
                      protocol: nextProtocol,
                      port: shouldUseDefaultPort ? defaultPortByProtocol[nextProtocol] : draft.port,
                    });
                  }}
                  sx={denseFieldSx}
                  fullWidth
                >
                  {protocolOptions.map((protocol) => (
                    <MenuItem key={protocol} value={protocol}>
                      {protocol}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={5}>
                <TextField
                  size="small"
                  label="端口"
                  placeholder={defaultPortByProtocol[draft.protocol]}
                  value={draft.port ?? ''}
                  error={!hasValidPort}
                  helperText={!hasValidPort ? '1-65535' : undefined}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      port: event.target.value.replace(/\D/g, ''),
                    })
                  }
                  inputProps={{ ...plainInputBehaviorProps, inputMode: 'numeric' }}
                  sx={denseFieldSx}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  size="small"
                  select
                  label="终端补全"
                  value={draft.terminalProfile ?? 'auto'}
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      terminalProfile: event.target.value as TerminalProfile,
                    })
                  }
                  sx={denseFieldSx}
                  fullWidth
                >
                  {terminalProfileOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12}>
                <TextField
                  size="small"
                  label="主机地址"
                  placeholder="example.internal"
                  value={draft.host}
                  onChange={(event) => onDraftChange({ ...draft, host: event.target.value })}
                  inputProps={plainInputBehaviorProps}
                  sx={denseFieldSx}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12}>
                <Autocomplete
                  freeSolo
                  selectOnFocus
                  handleHomeEndKeys
                  value={selectedDirectory || null}
                  inputValue={selectedDirectory}
                  options={directoryOptions}
                  noOptionsText="输入目录后按 Enter"
                  filterOptions={(options, state) => {
                    const filtered = filterDirectoryOptions(options, state);
                    const normalizedInput = normalizeDirectoryPath(state.inputValue);
                    if (normalizedInput && !options.includes(normalizedInput)) {
                      filtered.push(normalizedInput);
                    }

                    return filtered;
                  }}
                  onInputChange={(_event, value, reason) => {
                    if (reason === 'input') {
                      onDraftChange({
                        ...draft,
                        path: value,
                      });
                    }
                  }}
                  onChange={(_event, value) => {
                    handleCommitDirectory(typeof value === 'string' ? value : null);
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      size="small"
                      label="目录列表"
                      placeholder="输入目录后按 Enter"
                      inputProps={{ ...params.inputProps, ...plainInputBehaviorProps }}
                      sx={denseFieldSx}
                    />
                  )}
                  renderOption={(props, option) => {
                    const { key, ...optionProps } = props;
                    const isExisting = directoryOptions.includes(option);

                    return (
                      <MenuItem
                        key={key}
                        {...optionProps}
                        component="li"
                        sx={{ gap: 0.75, minHeight: 34, pr: 0.5 }}
                      >
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="body2" noWrap title={option}>
                            {option}
                          </Typography>
                          {!isExisting ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              noWrap
                              sx={{ display: 'block', mt: -0.2, fontSize: '0.66rem' }}
                            >
                              新增目录
                            </Typography>
                          ) : null}
                        </Box>
                        {isExisting ? (
                          <Tooltip title="删除目录">
                            <IconButton
                              size="small"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRemoveDirectory(option);
                              }}
                              sx={{ width: 24, height: 24, color: 'text.secondary', flexShrink: 0 }}
                            >
                              <DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />
                            </IconButton>
                          </Tooltip>
                        ) : (
                          <AddRoundedIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
                        )}
                      </MenuItem>
                    );
                  }}
                  sx={{
                    ...denseFieldSx,
                    '& .MuiAutocomplete-inputRoot': {
                      pr: '34px !important',
                    },
                  }}
                  slotProps={{
                    paper: {
                      sx: {
                        borderRadius: '12px',
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                        backgroundImage: 'none',
                      },
                    },
                    listbox: {
                      sx: { py: 0.35 },
                    },
                  }}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  size="small"
                  label="用户名"
                  placeholder="留空使用默认用户"
                  value={draft.username ?? ''}
                  onChange={(event) => onDraftChange({ ...draft, username: event.target.value })}
                  autoComplete="username"
                  inputProps={noTextTransformInputProps}
                  sx={denseFieldSx}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  size="small"
                  label="密码"
                  type="password"
                  placeholder={draft.protocol === 'WebDAV' ? 'WebDAV 必填' : '留空尝试 SSH 配置或私钥'}
                  value={draft.password ?? ''}
                  onChange={(event) => onDraftChange({ ...draft, password: event.target.value })}
                  autoComplete="current-password"
                  sx={denseFieldSx}
                  fullWidth
                />
              </Grid>
            </Grid>

            {notice ? (
              <Box
                sx={{
                  px: 0.86,
                  py: 0.58,
                  borderRadius: '11px',
                  border: `1px solid ${toneStyles[notice.tone].borderColor}`,
                  backgroundColor: toneStyles[notice.tone].backgroundColor,
                }}
              >
                <Stack direction="row" spacing={0.62} alignItems="flex-start">
                  {notice.tone === 'error' ? (
                    <ErrorOutlineRoundedIcon sx={{ fontSize: 16, color: 'text.secondary', mt: 0.1 }} />
                  ) : (
                    <CheckCircleRoundedIcon sx={{ fontSize: 16, color: 'text.secondary', mt: 0.1 }} />
                  )}
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700} sx={{ fontSize: '0.8rem' }}>
                      {notice.title}
                    </Typography>
                    {notice.detail ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        title={notice.detail}
                        sx={{
                          display: 'block',
                          mt: 0.08,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {notice.detail}
                      </Typography>
                    ) : null}
                    {connectionResult ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        sx={{ display: 'block', mt: 0.08 }}
                      >
                        {runtimeMode === 'live' ? '实时结果' : '预览结果'} · {connectionResult.protocol} ·{' '}
                        {connectionResult.remotePath ?? connectionResult.workingDirectory}
                      </Typography>
                    ) : null}
                  </Box>
                </Stack>
              </Box>
            ) : null}

            <Divider sx={{ borderColor: (theme) => theme.palette.divider, mt: 0.08 }} />
            <Box
              sx={{
                display: 'grid',
                gap: 0.65,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(3, minmax(0, 1fr))',
                },
              }}
            >
              <Button
                variant="contained"
                fullWidth
                disabled={!canSubmit || isTesting || isOpeningWorkbench}
                onClick={onTestConnection}
                sx={actionButtonSx}
              >
                {isTesting ? '连接中...' : '测试连接'}
              </Button>
              <Button
                variant="outlined"
                fullWidth
                disabled={!canSubmit || isSavingFavorite || isTesting || isOpeningWorkbench}
                onClick={onSaveDraftFavorite}
                sx={actionButtonSx}
              >
                {isSavingFavorite ? '保存中...' : '保存配置'}
              </Button>
              <Button
                variant="outlined"
                fullWidth
                disabled={!canSubmit || isOpeningWorkbench || isTesting}
                onClick={onOpenWorkbench}
                sx={actionButtonSx}
              >
                {isOpeningWorkbench && !openingConnectionId ? '进入中...' : '进入工作台'}
              </Button>
            </Box>
          </Stack>
        </Box>
      </Box>

      <Menu
        open={Boolean(actionMenu)}
        onClose={closeActionMenu}
        anchorEl={actionMenu?.anchorEl}
        PaperProps={{
          sx: {
            minWidth: 150,
            '& .MuiMenuItem-root': {
              minHeight: 34,
              fontSize: '0.82rem',
              gap: 0.72,
            },
          },
        }}
      >
        {actionMenu ? (
          <>
            <MenuItem
              onClick={() => {
                onSelectFavorite(actionMenu.item);
                closeActionMenu();
              }}
            >
              <EditRoundedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              编辑
            </MenuItem>
            <MenuItem
              onClick={() => {
                onOpenFavorite(actionMenu.item);
                closeActionMenu();
              }}
            >
              <PlayArrowRoundedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              连接
            </MenuItem>
            <MenuItem
              onClick={() => {
                handleRenameFavoriteFromMenu(actionMenu.item);
                closeActionMenu();
              }}
            >
              <EditRoundedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              重命名
            </MenuItem>
            <MenuItem
              onClick={() => {
                handleRemoveFavoriteFromMenu(actionMenu.item);
                closeActionMenu();
              }}
            >
              <DeleteOutlineRoundedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              删除
            </MenuItem>
          </>
        ) : null}
      </Menu>
    </Box>
  );
}
