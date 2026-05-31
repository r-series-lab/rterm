import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CleaningServicesRoundedIcon from '@mui/icons-material/CleaningServicesRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CloudQueueRoundedIcon from '@mui/icons-material/CloudQueueRounded';
import CreateNewFolderRoundedIcon from '@mui/icons-material/CreateNewFolderRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import ComputerRoundedIcon from '@mui/icons-material/ComputerRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DriveFileMoveRoundedIcon from '@mui/icons-material/DriveFileMoveRounded';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import FingerprintRoundedIcon from '@mui/icons-material/FingerprintRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import PowerSettingsNewRoundedIcon from '@mui/icons-material/PowerSettingsNewRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import UploadRoundedIcon from '@mui/icons-material/UploadRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import FolderSpecialRoundedIcon from '@mui/icons-material/FolderSpecialRounded';
import KeyboardDoubleArrowUpRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowUpRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  Dialog,
  IconButton,
  InputBase,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { Terminal as XTerm } from '@xterm/xterm';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { SectionCard } from '@/components/SectionCard';
import { resizeTerminalSession } from '@/lib/rterm-runtime';
import {
  applyTerminalCompletionSuggestion,
  buildTerminalCompletionAcceptInput,
  buildTerminalCompletionSuggestions,
  defaultTerminalCompletionConfig,
  nextTerminalCompletionInput,
  recordSubmittedTerminalCommand,
  shouldAcceptTerminalCompletion,
  terminalCompletionAcceptKeyLabel,
  type TerminalCompletionConfig,
  type TerminalCompletionSuggestion,
} from '@/lib/terminal-completion';
import type { RTermStyleMode } from '@/theme/rterm-theme';
import type {
  ConnectionDraft,
  ConnectionTestResult,
  FavoriteItem,
  FileMutationScope,
  RemoteSessionState,
  TerminalHistoryEntry,
  TerminalProfile,
  TransferQueueItem,
  WorkbenchState,
} from '@/lib/rterm-types';

type WorkbenchPageProps = {
  activeConnection: ConnectionDraft | null;
  connectionResult: ConnectionTestResult | null;
  workbenchState: WorkbenchState | null;
  selectedLocalPath: string | null;
  selectedRemotePath: string | null;
  selectedLocalPaths: string[];
  selectedRemotePaths: string[];
  transferQueue: TransferQueueItem[];
  terminalDirectory: string;
  terminalLabel: string;
  terminalHistory: TerminalHistoryEntry[];
  terminalSessionId: string | null;
  terminalOutput: string;
  terminalCompletionConfig: TerminalCompletionConfig;
  terminalProfile: TerminalProfile;
  favorites: FavoriteItem[];
  favoriteConnectionStateById: Record<string, FavoriteHostConnectionState>;
  favoriteRemotePoolSummaryById: Record<string, RemotePoolFavoriteSummary>;
  selectedFavoriteId: string | null;
  isRemoteBrowserConnected: boolean;
  browserPaneErrors: BrowserPaneErrors;
  isRefreshingLocal: boolean;
  isRefreshingRemote: boolean;
  isOpeningConnection: boolean;
  isSavingFavorite: boolean;
  isMutatingFiles: boolean;
  isRunningTerminal: boolean;
  isStartingTerminal: boolean;
  showHidden: boolean;
  openingConnectionId: string | null;
  onRefreshLocal: () => void;
  onRefreshRemote: () => void;
  onToggleShowHidden: () => void;
  onConnectRemoteBrowser: () => void;
  onDisconnectRemoteBrowser: () => void;
  onSelectLocalEntry: (entry: DirectoryEntry, options?: { toggle?: boolean; range?: boolean; rangePaths?: string[] }) => void;
  onSelectRemoteEntry: (entry: DirectoryEntry, options?: { toggle?: boolean; range?: boolean; rangePaths?: string[] }) => void;
  onNavigateLocal: (path: string) => void;
  onNavigateRemote: (path: string) => void;
  onActivateEntry: (scope: FileMutationScope, entry: DirectoryEntry) => void;
  onCreateDirectory: (scope: FileMutationScope) => void;
  onOpenEntry: (scope: FileMutationScope, entry?: DirectoryEntry | null) => void;
  onPreviewEntry: (scope: FileMutationScope, entry?: DirectoryEntry | null) => void;
  onMd5Entry: (scope: FileMutationScope, entry?: DirectoryEntry | null) => void;
  onRenameEntry: (scope: FileMutationScope, entry?: DirectoryEntry | null) => void;
  onCopyEntry: (scope: FileMutationScope, entry?: DirectoryEntry | null) => void;
  onMoveEntry: (scope: FileMutationScope, entry?: DirectoryEntry | null) => void;
  onChangePermissions: (scope: FileMutationScope, entry?: DirectoryEntry | null) => void;
  onDeleteEntry: (scope: FileMutationScope, entry?: DirectoryEntry | null) => void;
  onQueueUpload: (entry?: DirectoryEntry | null) => void;
  onQueueDownload: (entry?: DirectoryEntry | null) => void;
  onQueueRemoteCopy: (entry?: DirectoryEntry | null) => void;
  onOpenSearchDialog: (scope: FileMutationScope, directory?: string | null, targets?: DirectoryEntry[]) => void;
  onCancelTransfer: (transferId: string) => void;
  onRetryTransfer: (transferId: string) => void;
  onClearCompletedTransfers: () => void;
  onClearStoppedTransfers: () => void;
  onRetryStoppedTransfers: () => void;
  onStartTerminalSession: () => void;
  onStopTerminalSession: () => void;
  onSendTerminalInput: (input: string, raw?: boolean) => void;
  onTerminalDebug?: (message: string) => void;
  onClearTerminalHistory: () => void;
  onOpenConnectionDialog: () => void;
  onSelectFavoriteTab: (favorite: FavoriteItem) => void;
  onOpenFavoriteConfig: (favorite: FavoriteItem) => void;
  onRenameFavoriteTab: (favorite: FavoriteItem) => void;
  onRemoveFavoriteTab: (favorite: FavoriteItem) => void;
  onCloseFavoriteTerminal: (favorite: FavoriteItem) => void;
  onDisconnectFavoriteConnection: (favorite: FavoriteItem) => void;
  onSaveFavoriteDirectory: (favorite: FavoriteItem) => void;
  onOpenFavoriteDirectory: (favorite: FavoriteItem, path: string) => void;
  canUseRemoteTerminal: boolean;
  styleMode: RTermStyleMode;
  onToggleStyleMode: () => void;
};

type ListingData = WorkbenchState['local'];
type DirectoryEntry = ListingData['entries'][number];
type FavoriteHostConnectionState = 'running' | 'connecting' | 'connected' | 'ready' | 'incomplete';
type RemotePoolFavoriteSummary = {
  total: number;
  connected: number;
  latest: RemoteSessionState | null;
};

const plainInputBehaviorProps = {
  autoCapitalize: 'none',
  autoComplete: 'off',
  autoCorrect: 'off',
  spellCheck: false,
} as const;

export type BrowserPaneError = {
  path: string;
  message: string;
};

export type BrowserPaneErrors = {
  local: BrowserPaneError | null;
  remote: BrowserPaneError | null;
};

type BrowserSortMode = 'name' | 'size' | 'kind' | 'modified';
type EmptyStateVariant = 'loading' | 'remote' | 'empty' | 'search' | 'queue';

type EntryActionMenuTrigger = {
  anchorEl?: HTMLElement | null;
  anchorPosition?: {
    top: number;
    left: number;
  } | null;
};

type EntryActionMenuState = {
  scope: FileMutationScope;
  entry: DirectoryEntry | null;
  anchorEl: HTMLElement | null;
  anchorPosition: EntryActionMenuTrigger['anchorPosition'];
};

const browserSortLabel: Record<BrowserSortMode, string> = {
  name: '名称',
  size: '大小',
  kind: '类型',
  modified: '时间',
};

function isArchiveEntry(entry: DirectoryEntry | null): boolean {
  const lowered = entry?.name.toLowerCase() ?? '';
  return (
    lowered.endsWith('.tar.gz') ||
    lowered.endsWith('.tgz') ||
    lowered.endsWith('.tar') ||
    lowered.endsWith('.zip')
  );
}

const transferQueueGridTemplate =
  'minmax(190px, 1.28fr) 76px minmax(150px, 1fr) minmax(150px, 1fr) 78px minmax(138px, 0.82fr) 86px 78px 46px';

const emptyStateCopy: Record<
  EmptyStateVariant,
  {
    title: string;
  }
> = {
  loading: {
    title: '读取目录中',
  },
  remote: {
    title: '远端待连接',
  },
  empty: {
    title: '当前目录为空',
  },
  search: {
    title: '没有匹配项目',
  },
  queue: {
    title: '队列空闲',
  },
};

function compareEntryNames(left: DirectoryEntry, right: DirectoryEntry): number {
  return left.name.localeCompare(right.name, 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function formatEntryModifiedAt(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  const now = new Date();
  const datePart =
    date.getFullYear() === now.getFullYear()
      ? `${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`
      : `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;

  return `${datePart} ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function formatEntryModifiedAtTitle(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '更新时间未知';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '更新时间未知';
  }

  return `更新时间 ${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
    date.getDate(),
  )} ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`;
}

function formatPoolTimestamp(value?: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '未知';
  }

  return formatEntryModifiedAt(value);
}

function remotePoolSummaryLabel(summary?: RemotePoolFavoriteSummary | null): string {
  if (!summary || summary.total === 0) {
    return '连接池空闲';
  }

  const latestUsed = formatPoolTimestamp(summary.latest?.lastUsedAt);
  const error = summary.latest?.lastError ? ` · ${summary.latest.lastError}` : '';
  return `连接池 ${summary.connected}/${summary.total} · 最近 ${latestUsed}${error}`;
}

function sortBrowserEntries(entries: DirectoryEntry[], mode: BrowserSortMode): DirectoryEntry[] {
  return [...entries].sort((left, right) => {
    if (mode === 'kind') {
      if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1;
      }

      const leftExtension = left.name.includes('.') ? left.name.split('.').pop() ?? '' : '';
      const rightExtension = right.name.includes('.') ? right.name.split('.').pop() ?? '' : '';
      const extensionDelta = leftExtension.localeCompare(rightExtension, 'zh-CN', {
        numeric: true,
        sensitivity: 'base',
      });
      if (extensionDelta !== 0) {
        return extensionDelta;
      }
    }

    if (mode === 'modified') {
      const timeDelta = (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0);
      if (timeDelta !== 0) {
        return timeDelta;
      }
    }

    if (mode === 'size') {
      const sizeDelta = right.size - left.size;
      if (sizeDelta !== 0) {
        return sizeDelta;
      }
    }

    if (mode === 'name' && left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }

    return compareEntryNames(left, right);
  });
}

function findParentDirectory(path: string): string | null {
  if (!path || path === '/' || path === '~') {
    return null;
  }

  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  const lastSlash = normalized.lastIndexOf('/');

  if (lastSlash < 0) {
    return null;
  }

  if (lastSlash === 0) {
    return normalized.startsWith('~/') ? '~' : '/';
  }

  return normalized.slice(0, lastSlash);
}

function connectionEndpoint(host: string, port?: number | string | null) {
  return port ? `${host}:${port}` : host;
}

function normalizedConnectionHost(host: string) {
  return host.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').toLowerCase();
}

function normalizeConnectionPath(path?: string | null) {
  const trimmed = path?.trim() ?? '';
  if (!trimmed) {
    return '/';
  }

  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return `/${trimmed.replaceAll('\\', '/')}`;
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function favoriteDirectoryPaths(favorite: FavoriteItem) {
  const seen = new Set<string>();
  return [favorite.path, ...(favorite.paths ?? [])]
    .map((path) => normalizeConnectionPath(path))
    .filter((path) => {
      if (seen.has(path)) {
        return false;
      }

      seen.add(path);
      return true;
    });
}

function favoriteMatchesActiveEndpoint(favorite: FavoriteItem, activeConnection: ConnectionDraft | null) {
  return Boolean(
    activeConnection &&
      favorite.protocol === activeConnection.protocol &&
      normalizedConnectionHost(favorite.host) === normalizedConnectionHost(activeConnection.host) &&
      String(favorite.port ?? '') === String(activeConnection.port ?? '').trim() &&
      (favorite.username?.trim() ?? '') === (activeConnection.username?.trim() ?? ''),
  );
}

function PathTrail({ path }: { path: string }) {
  const muiTheme = useTheme();
  const isLight = muiTheme.palette.mode === 'light';
  const borderColor = isLight ? 'rgba(31,34,39,0.14)' : 'rgba(255,255,255,0.07)';
  const backgroundColor = isLight ? 'rgba(31,34,39,0.035)' : 'rgba(255,255,255,0.018)';
  const focusBorderColor = isLight ? 'rgba(31,34,39,0.32)' : 'rgba(245,243,238,0.2)';

  return (
    <InputBase
      value={path || '/'}
      readOnly
      title={path || '/'}
      inputProps={{
        ...plainInputBehaviorProps,
        'aria-label': '当前目录完整路径',
      }}
      onFocus={(event) => {
        event.currentTarget.select();
      }}
      sx={{
        '&&': {
          backgroundColor,
        },
        width: '100%',
        height: 28,
        minWidth: 0,
        borderRadius: '9px',
        border: `1px solid ${borderColor}`,
        color: 'text.primary',
        transition: 'border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease',
        boxShadow: isLight
          ? 'inset 0 1px 2px rgba(31,34,39,0.045)'
          : 'inset 0 1px 0 rgba(255,255,255,0.022)',
        '&.Mui-focused': {
          borderColor: focusBorderColor,
          backgroundColor: isLight ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.036)',
          boxShadow: isLight ? '0 0 0 2px rgba(31,34,39,0.055)' : '0 0 0 2px rgba(245,243,238,0.07)',
        },
        '& .MuiInputBase-input': {
          px: 0.72,
          py: 0,
          height: '100%',
          boxSizing: 'border-box',
          fontSize: '0.77rem',
          fontWeight: 560,
          lineHeight: '28px',
          letterSpacing: 0,
          cursor: 'text',
          whiteSpace: 'nowrap',
          overflowX: 'auto',
          textOverflow: 'clip',
          '&::selection': {
            backgroundColor: isLight ? 'rgba(31,34,39,0.22)' : 'rgba(245,243,238,0.22)',
          },
          '&::-webkit-scrollbar': {
            height: 0,
            width: 0,
          },
        },
      }}
    />
  );
}

function EmptyStateArt({ variant }: { variant: EmptyStateVariant }) {
  const muiTheme = useTheme();
  const isLight = muiTheme.palette.mode === 'light';
  const isQueue = variant === 'queue';
  const isRemote = variant === 'remote';
  const isSearch = variant === 'search';
  const stroke = isLight ? 'rgba(23,33,51,0.46)' : 'rgba(244,247,251,0.46)';
  const softStroke = isLight ? 'rgba(23,33,51,0.16)' : 'rgba(244,247,251,0.13)';
  const fill = isRemote
    ? 'var(--rterm-remote-soft)'
    : isQueue || isSearch
      ? 'var(--rterm-accent-soft)'
      : 'var(--rterm-local-soft)';
  const accent = isRemote
    ? 'var(--rterm-remote)'
    : isQueue
      ? 'var(--rterm-accent)'
      : isSearch
        ? 'var(--rterm-local)'
        : 'var(--rterm-local)';

  return (
    <Box
      component="svg"
      viewBox="0 0 104 56"
      role="img"
      aria-hidden="true"
      sx={{ width: 88, height: 48, flexShrink: 0 }}
    >
      {isQueue ? (
        <>
          <path d="M27 17h30M27 28h24M27 39h30" stroke={softStroke} strokeWidth="4" strokeLinecap="round" />
          <path d="M57 28h18" stroke={accent} strokeWidth="4" strokeLinecap="round" />
          <path d="M69 20l9 8-9 8" fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : isRemote ? (
        <>
          <path
            d="M64 25h7a7 7 0 0 0 .3-14 10 10 0 0 0-19.5-2 8 8 0 0 0-1.8 16h7"
            fill={fill}
            stroke={stroke}
            strokeWidth="3.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M61 27v8" stroke={accent} strokeWidth="3.4" strokeLinecap="round" />
          <path
            d="M33 35h18l4 5h26v14H33z"
            fill={fill}
            stroke={stroke}
            strokeWidth="3.6"
            strokeLinejoin="round"
          />
          <path d="M42 46h20" stroke={softStroke} strokeWidth="3.4" strokeLinecap="round" />
        </>
      ) : isSearch ? (
        <>
          <circle cx="50" cy="25" r="12" fill={fill} stroke={stroke} strokeWidth="4" />
          <path d="M59 34l10 10" stroke={stroke} strokeWidth="4" strokeLinecap="round" />
          <path d="M27 22h11M27 34h8" stroke={softStroke} strokeWidth="4" strokeLinecap="round" />
        </>
      ) : variant === 'loading' ? (
        <>
          <path
            d="M23 21h20l5 7h33v24H23z"
            fill={fill}
            stroke={stroke}
            strokeWidth="3.6"
            strokeLinejoin="round"
          />
          <path d="M31 38h25M31 46h16" stroke={softStroke} strokeWidth="3.4" strokeLinecap="round" />
          <path
            d="M69 37a8 8 0 1 1-3.6 6.7"
            fill="none"
            stroke={accent}
            strokeWidth="3.4"
            strokeLinecap="round"
          />
          <path d="M66 35h7v7" fill="none" stroke={accent} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path
            d="M24 21h20l5 7h34v24H24z"
            fill={fill}
            stroke={stroke}
            strokeWidth="3.6"
            strokeLinejoin="round"
          />
          <path d="M33 38h28M33 46h20" stroke={softStroke} strokeWidth="3.4" strokeLinecap="round" />
          <path d="M72 18h8M76 14v8" stroke={accent} strokeWidth="3.4" strokeLinecap="round" />
        </>
      )}
    </Box>
  );
}

function EmptyStatePanel({ variant }: { variant: EmptyStateVariant }) {
  const copy = emptyStateCopy[variant];
  const shouldShowTitle = variant !== 'loading' && variant !== 'remote' && variant !== 'queue';

  return (
    <Box
      sx={{
        minHeight: 126,
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        px: 1.1,
        py: 1.25,
      }}
    >
      <Stack spacing={0.42} alignItems="center" textAlign="center" sx={{ maxWidth: 220 }}>
        <EmptyStateArt variant={variant} />
        {shouldShowTitle ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontSize: '0.8rem', fontWeight: 600, letterSpacing: '-0.02em', opacity: 0.74 }}
          >
            {copy.title}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

function BrowserErrorPanel({ error, compact = false }: { error: BrowserPaneError; compact?: boolean }) {
  const muiTheme = useTheme();
  const isLight = muiTheme.palette.mode === 'light';
  const borderColor = isLight ? 'rgba(144,56,56,0.18)' : 'rgba(255,178,178,0.18)';
  const backgroundColor = isLight ? 'rgba(144,56,56,0.045)' : 'rgba(255,178,178,0.055)';

  return (
    <Box
      sx={{
        minHeight: compact ? 'auto' : 126,
        height: compact ? 'auto' : '100%',
        display: 'grid',
        placeItems: compact ? 'stretch' : 'center',
        px: compact ? 0.35 : 1.1,
        py: compact ? 0.35 : 1.25,
      }}
    >
      <Stack
        spacing={0.42}
        alignItems={compact ? 'flex-start' : 'center'}
        textAlign={compact ? 'left' : 'center'}
        sx={{
          width: '100%',
          maxWidth: compact ? 'none' : 280,
          borderRadius: '10px',
          border: `1px solid ${borderColor}`,
          backgroundColor,
          px: compact ? 0.72 : 1,
          py: compact ? 0.58 : 0.82,
        }}
      >
        <Stack direction="row" spacing={0.55} alignItems="center" sx={{ minWidth: 0 }}>
          <ErrorOutlineRoundedIcon sx={{ fontSize: 16, color: 'error.main', flexShrink: 0 }} />
          <Typography variant="body2" fontWeight={700} noWrap>
            无法打开目录
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" noWrap title={error.path} sx={{ maxWidth: '100%' }}>
          {error.path}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            maxWidth: '100%',
            display: '-webkit-box',
            overflow: 'hidden',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: compact ? 1 : 3,
          }}
          title={error.message}
        >
          {error.message}
        </Typography>
      </Stack>
    </Box>
  );
}

function BrowserPane({
  title,
  directory,
  entries,
  icon,
  operation,
  selectedPath,
  selectedPaths,
  isBusy,
  isInteractive,
  emptyStateVariant,
  error,
  onSelectEntry,
  onActivateEntry,
  onContextMenu,
  onNavigate,
}: {
  title: string;
  directory: string;
  entries: DirectoryEntry[];
  icon: ReactNode;
  operation?: ReactNode;
  selectedPath: string | null;
  selectedPaths: string[];
  isBusy: boolean;
  isInteractive: boolean;
  emptyStateVariant: EmptyStateVariant;
  error?: BrowserPaneError | null;
  onSelectEntry: (entry: DirectoryEntry, options?: { toggle?: boolean; range?: boolean; rangePaths?: string[] }) => void;
  onActivateEntry?: (entry: DirectoryEntry) => void;
  onContextMenu?: (
    entry: DirectoryEntry,
    trigger?: {
      top: number;
      left: number;
    },
  ) => void;
  onNavigate: (path: string) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortMode, setSortMode] = useState<BrowserSortMode>('name');
  const parentDirectory = findParentDirectory(directory);
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase();
  const filteredEntries = sortBrowserEntries(
    entries.filter((entry) =>
      normalizedSearch ? entry.name.toLocaleLowerCase().includes(normalizedSearch) : true,
    ),
    sortMode,
  );
  const visibleRangePathsFor = (targetPath: string): string[] => {
    const anchorPath = selectedPath ?? selectedPaths[selectedPaths.length - 1] ?? null;
    if (!anchorPath) {
      return [targetPath];
    }

    const anchorIndex = filteredEntries.findIndex((entry) => entry.path === anchorPath);
    const targetIndex = filteredEntries.findIndex((entry) => entry.path === targetPath);
    if (anchorIndex < 0 || targetIndex < 0) {
      return [targetPath];
    }

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    return filteredEntries.slice(start, end + 1).map((entry) => entry.path);
  };
  const visibleEntries = filteredEntries;
  const hasError = Boolean(error?.message);
  const muiTheme = useTheme();
  const isLight = muiTheme.palette.mode === 'light';
  const paneTone = title === '远端' || emptyStateVariant === 'remote' ? 'remote' : 'local';
  const paneAccent = paneTone === 'remote' ? 'var(--rterm-remote)' : 'var(--rterm-local)';
  const paneAccentSoft = paneTone === 'remote' ? 'var(--rterm-remote-soft)' : 'var(--rterm-local-soft)';
  const paneAccentBorder = paneTone === 'remote' ? 'var(--rterm-remote-border)' : 'var(--rterm-local-border)';
  const paneBorder = 'var(--rterm-panel-border)';
  const paneBorderStrong = 'var(--rterm-panel-border-strong)';
  const paneBg = isLight ? 'rgba(255,255,255,0.78)' : 'rgba(12,18,26,0.64)';
  const controlBg = isLight ? 'rgba(31,34,39,0.045)' : 'rgba(255,255,255,0.018)';
  const controlHoverBg = isLight ? 'rgba(31,34,39,0.07)' : 'rgba(255,255,255,0.05)';
  const selectedBg = isLight ? 'rgba(37,99,235,0.045)' : 'rgba(79,140,255,0.045)';
  const rowHoverBg = isLight ? 'rgba(31,34,39,0.045)' : 'rgba(255,255,255,0.035)';
  const disabledColor = isLight ? 'rgba(31,34,39,0.42)' : 'rgba(255,255,255,0.34)';
  const scrollbarThumb = isLight ? 'rgba(31,34,39,0.24)' : 'rgba(255,255,255,0.24)';
  const scrollbarTrack = isLight ? 'rgba(31,34,39,0.045)' : 'rgba(255,255,255,0.035)';

  useEffect(() => {
    setSearchTerm('');
  }, [directory]);

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '13px',
        border: `1px solid ${paneBorder}`,
        backgroundColor: paneBg,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,${isLight ? 0.68 : 0.035})`,
        overflow: 'hidden',
      }}
    >
      <Stack spacing={0.48} sx={{ p: { xs: 0.58, md: 0.64 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={0.75}
          sx={{ minWidth: 0 }}
        >
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
            <Box
              sx={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                border: `1px solid ${paneBorder}`,
                backgroundColor: paneAccentSoft,
                color: paneAccent,
                boxShadow: `0 0 0 1px ${paneAccentSoft}`,
              }}
            >
              {icon}
            </Box>
            <Typography variant="body2" fontWeight={700} noWrap sx={{ minWidth: 0 }}>
              {title}
            </Typography>
          </Stack>
          <Stack
            direction="row"
            spacing={0.55}
            alignItems="center"
            justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}
            useFlexGap
            flexWrap="wrap"
            sx={{
              minWidth: 0,
              ml: { sm: 'auto' },
              flexShrink: 0,
            }}
          >
            <Box sx={{ display: 'flex', minWidth: 0, flexShrink: 0 }}>
              {operation}
            </Box>
          </Stack>
        </Stack>
        <Box
          sx={{
            minWidth: 0,
            display: 'grid',
            gap: 0.42,
            p: 0.42,
            borderRadius: '11px',
            border: `1px solid ${paneAccentBorder}`,
            backgroundColor: isLight ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.018)',
            boxShadow: isLight ? 'inset 0 1px 0 rgba(255,255,255,0.82)' : 'none',
          }}
        >
          <Stack direction="row" spacing={0.42} alignItems="center" sx={{ minWidth: 0 }}>
            <Tooltip title="返回上一级">
              <span>
                <IconButton
                  size="small"
                  aria-label="返回上一级"
                  disabled={!isInteractive || !parentDirectory || isBusy}
                  onClick={() => parentDirectory && onNavigate(parentDirectory)}
                  sx={{
                    width: 28,
                    height: 28,
                    flexShrink: 0,
                    border: `1px solid ${paneBorder}`,
                    backgroundColor: controlBg,
                    color: 'text.primary',
                    '&:hover': {
                      backgroundColor: controlHoverBg,
                      borderColor: paneBorderStrong,
                    },
                    '&.Mui-disabled': {
                      borderColor: paneBorder,
                      backgroundColor: controlBg,
                      color: disabledColor,
                    },
                  }}
                >
                  <ArrowBackRoundedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </span>
            </Tooltip>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <PathTrail path={directory} />
            </Box>
          </Stack>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={0.42}
            alignItems={{ xs: 'stretch', sm: 'center' }}
          >
            <Box
              sx={{
                minWidth: 0,
                flex: 1,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                gap: 0.46,
                px: 0.56,
                borderRadius: '9px',
                border: `1px solid ${isLight ? 'rgba(31,34,39,0.14)' : paneBorder}`,
                backgroundColor: isLight ? 'rgba(255,255,255,0.86)' : 'rgba(255,255,255,0.026)',
                boxShadow: isLight
                  ? 'inset 0 1px 2px rgba(31,34,39,0.055)'
                  : 'inset 0 1px 0 rgba(255,255,255,0.025)',
              }}
            >
              <SearchRoundedIcon sx={{ fontSize: 14, color: paneAccent, opacity: 0.82 }} />
              <InputBase
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="筛选当前目录"
                disabled={isBusy}
                inputProps={plainInputBehaviorProps}
                sx={{
                  '&&': {
                    backgroundColor: 'transparent',
                  },
                  flex: 1,
                  minWidth: 0,
                  color: 'text.primary',
                  fontSize: '0.76rem',
                  backgroundColor: 'transparent',
                  '& .MuiInputBase-input': {
                    py: 0,
                  },
                  '& input::placeholder': {
                    color: isLight ? 'rgba(31,34,39,0.5)' : 'rgba(255,255,255,0.42)',
                    opacity: 1,
                  },
                }}
              />
            </Box>
            <TextField
              select
              size="small"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as BrowserSortMode)}
              disabled={isBusy}
              sx={{
                width: { xs: '100%', sm: 76 },
                '& .MuiOutlinedInput-root': {
                  height: 28,
                  borderRadius: '9px',
                  backgroundColor: isLight ? 'rgba(255,255,255,0.86)' : controlBg,
                },
                '& .MuiSelect-select': {
                  py: 0,
                  fontSize: '0.76rem',
                },
              }}
            >
              {Object.entries(browserSortLabel).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            {selectedPaths.length > 0 ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  px: 0.24,
                  flexShrink: 0,
                  alignSelf: { xs: 'flex-start', sm: 'center' },
                  fontSize: '0.68rem',
                  whiteSpace: 'nowrap',
                }}
              >
                已选 {selectedPaths.length}
              </Typography>
            ) : null}
          </Stack>
        </Box>
      </Stack>

      <Divider />

      <Box
        sx={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          height: 0,
          overflow: 'hidden',
        }}
      >
        <Stack
          spacing={0}
          sx={{
          p: 0.35,
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          overscrollBehavior: 'contain',
          scrollbarGutter: 'stable',
          scrollbarWidth: 'thin',
          scrollbarColor: `${scrollbarThumb} ${scrollbarTrack}`,
          '&::-webkit-scrollbar': {
            width: 7,
          },
          '&::-webkit-scrollbar-track': {
            backgroundColor: scrollbarTrack,
            borderRadius: 999,
          },
          '&::-webkit-scrollbar-thumb': {
            backgroundColor: scrollbarThumb,
            borderRadius: 999,
          },
        }}
      >
        {visibleEntries.length > 0 ? (
          <>
            {hasError && error ? <BrowserErrorPanel error={error} compact /> : null}
            {visibleEntries.map((entry) => {
              const isDirectory = entry.kind === 'directory';
              const isSelected = selectedPaths.includes(entry.path) || selectedPath === entry.path;
              const modifiedLabel = formatEntryModifiedAt(entry.modifiedAt);

              return (
                  <Box
                    key={entry.path}
                    onMouseDown={(event) => {
                      if (event.shiftKey) {
                        event.preventDefault();
                      }
                    }}
                    onClick={(event) => {
                      if (!isInteractive || isBusy) {
                        return;
                      }

                      if (event.shiftKey) {
                        event.preventDefault();
                      }

                      onSelectEntry(entry, {
                        toggle: event.metaKey || event.ctrlKey,
                        range: event.shiftKey,
                        rangePaths: event.shiftKey ? visibleRangePathsFor(entry.path) : undefined,
                      });
                    }}
                  onContextMenu={(event) => {
                    if (!isInteractive || isBusy) {
                      return;
                    }

                    event.preventDefault();
                    onContextMenu?.(entry, {
                      top: event.clientY + 4,
                      left: event.clientX + 2,
                    });
                  }}
                  onDoubleClick={() => {
                    if (!isInteractive || isBusy) {
                      return;
                    }

                    onSelectEntry(entry);

                    if (isDirectory) {
                      onNavigate(entry.path);
                      return;
                    }

                    onActivateEntry?.(entry);
                  }}
                  sx={{
                    px: 0.68,
                    py: 0.58,
                    border: '1px solid transparent',
                    borderRadius: '9px',
                    backgroundColor: isSelected ? selectedBg : 'transparent',
                    borderColor: isSelected ? paneAccentBorder : 'transparent',
                    cursor: isInteractive && !isBusy ? 'pointer' : 'default',
                    userSelect: 'none',
                    transition: 'background-color 120ms ease, border-color 120ms ease',
                    '&:hover': isInteractive && !isBusy ? { backgroundColor: rowHoverBg } : undefined,
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={0.85} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                      <FolderRoundedIcon
                        sx={{
                          fontSize: 15,
                          color: isDirectory ? paneAccent : 'text.secondary',
                          opacity: isDirectory ? 0.88 : 0.48,
                        }}
                      />
                      <Typography variant="body2" noWrap title={entry.name} sx={{ minWidth: 0, flex: 1 }}>
                        {entry.name}
                      </Typography>
                    </Stack>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                      title={formatEntryModifiedAtTitle(entry.modifiedAt)}
                      sx={{
                        width: { xs: 84, sm: 104 },
                        flexShrink: 0,
                        textAlign: 'right',
                        fontSize: '0.68rem',
                        fontVariantNumeric: 'tabular-nums',
                        opacity: modifiedLabel === '-' ? 0.55 : 0.78,
                      }}
                    >
                      {modifiedLabel}
                    </Typography>
                  </Stack>
                </Box>
              );
            })}
          </>
        ) : hasError && error ? (
          <BrowserErrorPanel error={error} />
        ) : (
          <EmptyStatePanel variant={normalizedSearch ? 'search' : emptyStateVariant} />
        )}
        </Stack>
        {isBusy ? (
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              right: 10,
              px: 0.72,
              py: 0.42,
              borderRadius: '999px',
              border: `1px solid ${paneBorderStrong}`,
              backgroundColor: isLight ? 'rgba(255,255,255,0.94)' : 'rgba(11,12,14,0.82)',
              backdropFilter: isLight ? 'none' : 'blur(14px)',
              boxShadow: isLight ? '0 10px 24px rgba(31,34,39,0.12)' : '0 10px 28px rgba(0,0,0,0.28)',
              display: 'flex',
              alignItems: 'center',
              gap: 0.55,
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            <CircularProgress
              size={13}
              thickness={4.5}
              sx={{ color: paneAccent }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>
              读取目录
            </Typography>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

function PaneOperationButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const muiTheme = useTheme();
  const isLight = muiTheme.palette.mode === 'light';
  const buttonBorder = 'var(--rterm-panel-border)';
  const buttonBorderHover = 'var(--rterm-accent-border)';
  const buttonBg = 'var(--rterm-control-bg)';
  const buttonBgHover = 'var(--rterm-accent-soft)';
  const disabledColor = isLight ? 'rgba(31,34,39,0.42)' : 'rgba(255,255,255,0.34)';

  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          size="small"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          sx={{
            width: 30,
            height: 30,
            flexShrink: 0,
            border: `1px solid ${buttonBorder}`,
            backgroundColor: buttonBg,
            color: 'text.primary',
            '&:hover': {
              backgroundColor: buttonBgHover,
              borderColor: buttonBorderHover,
              color: 'var(--rterm-accent)',
            },
            '&.Mui-disabled': {
              borderColor: buttonBorder,
              backgroundColor: buttonBg,
              color: disabledColor,
            },
          }}
        >
          {icon}
        </IconButton>
      </span>
    </Tooltip>
  );
}

const transferStatusLabel = {
  queued: '待执行',
  running: '传输中',
  done: '完成',
  failed: '失败',
  cancelled: '已取消',
} as const;

function formatByteSize(bytes?: number): string {
  if (!bytes) {
    return '0 B';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatTransferSpeed(bytesPerSecond?: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) {
    return '计算速度中';
  }

  return `${formatByteSize(bytesPerSecond)}/s`;
}

function fileNameFromPath(path?: string): string | null {
  if (!path) {
    return null;
  }

  const normalized = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

function transferSummary(item: TransferQueueItem): string {
  const attemptSuffix =
    (item.attemptCount ?? 1) > 1 ? ` · 已重试 ${(item.attemptCount ?? 1) - 1} 次` : '';

  if (item.status === 'failed') {
    return `${item.errorMessage ?? '传输失败'}${attemptSuffix}`;
  }

  if (item.status === 'done') {
    const transferred = item.filesTransferred ?? 0;
    const skipped = item.skipped ?? 0;
    const renamed = item.renamed ?? 0;

    if (skipped > 0 && transferred === 0) {
      return `未变化，跳过 ${skipped} 项`;
    }

    if (renamed > 0) {
      return `${transferred} 项 · ${formatByteSize(item.bytesTransferred)} · 重命名 ${renamed} 项${attemptSuffix}`;
    }

    return `${transferred} 项 · ${formatByteSize(item.bytesTransferred)}${attemptSuffix}`;
  }

  if (item.status === 'cancelled') {
    return `传输已取消${attemptSuffix}`;
  }

  if (item.status === 'running') {
    const currentPath = fileNameFromPath(item.currentPath);
    const totalBytes =
      item.size > 0
        ? `${formatByteSize(item.bytesTransferred)} / ${formatByteSize(item.size)}`
        : formatByteSize(item.bytesTransferred);
    return `${Math.max(1, Math.round(item.progress))}% · ${totalBytes} · ${formatTransferSpeed(
      item.speedBytesPerSecond,
    )}${currentPath ? ` · ${currentPath}` : ''}${attemptSuffix}`;
  }

  if (item.status === 'queued' && item.currentPath) {
    return `${item.currentPath}${attemptSuffix}`;
  }

  return item.direction === 'upload' ? '本地 -> 远端' : '远端 -> 本地';
}

function summarizeTransferQueue(items: TransferQueueItem[]) {
  const summary = {
    total: items.length,
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
    latest: null as TransferQueueItem | null,
  };

  for (const item of items) {
    summary[item.status] += 1;

    if (
      summary.latest == null ||
      (item.lastUpdatedAt ?? item.createdAt) > (summary.latest.lastUpdatedAt ?? summary.latest.createdAt)
    ) {
      summary.latest = item;
    }
  }

  return summary;
}

function TransferQueueDock({
  items,
  summary,
  onCancel,
  onRetry,
  onClearCompleted,
  onClearStopped,
  onRetryStopped,
  compact = false,
}: {
  items: TransferQueueItem[];
  summary: ReturnType<typeof summarizeTransferQueue>;
  onCancel: (transferId: string) => void;
  onRetry: (transferId: string) => void;
  onClearCompleted: () => void;
  onClearStopped: () => void;
  onRetryStopped: () => void;
  compact?: boolean;
}) {
  const muiTheme = useTheme();
  const isLight = muiTheme.palette.mode === 'light';
  const surfaceBorder = 'var(--rterm-panel-border)';
  const surfaceBorderStrong = 'var(--rterm-panel-border-strong)';
  const mutedText = isLight ? 'rgba(38,42,49,0.58)' : 'rgba(235,232,226,0.58)';
  const rowHover = isLight ? 'rgba(37,99,235,0.045)' : 'rgba(116,151,196,0.06)';
  const stats = [
    { key: 'running', label: '运行', count: summary.running },
    { key: 'queued', label: '等待', count: summary.queued },
    { key: 'failed', label: '失败', count: summary.failed },
    { key: 'done', label: '完成', count: summary.done },
    { key: 'cancelled', label: '取消', count: summary.cancelled },
  ].filter((stat) => stat.count > 0);
  const stoppedCount = summary.failed + summary.cancelled;
  const hasRetryableStopped = items.some(
    (item) => (item.status === 'failed' || item.status === 'cancelled') && item.retryPayload,
  );

  const statusColor = (status: TransferQueueItem['status']) => {
    if (status === 'running') {
      return 'var(--rterm-accent)';
    }

    if (status === 'done') {
      return 'var(--rterm-success)';
    }

    if (status === 'failed') {
      return 'var(--rterm-danger)';
    }

    if (status === 'queued') {
      return 'var(--rterm-warning)';
    }

    return isLight ? 'rgba(38,42,49,0.48)' : 'rgba(245,243,238,0.48)';
  };

  const statusBackground = (status: TransferQueueItem['status']) => {
    if (status === 'failed') {
      return 'var(--rterm-danger-soft)';
    }

    if (status === 'done') {
      return 'var(--rterm-success-soft)';
    }

    if (status === 'running') {
      return 'var(--rterm-accent-soft)';
    }

    if (status === 'queued') {
      return 'var(--rterm-warning-soft)';
    }

    return isLight ? 'rgba(36,39,45,0.045)' : 'rgba(255,255,255,0.035)';
  };

  const renderPath = (path: string) => (
    <Typography
      variant="caption"
      noWrap
      title={path}
      sx={{
        display: 'block',
        minWidth: 0,
        fontSize: '0.68rem',
        color: mutedText,
        letterSpacing: '-0.01em',
      }}
    >
      {path}
    </Typography>
  );

  return (
    <Box
      sx={{
        mt: compact ? 0 : 0.72,
        flex: '1 1 auto',
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        border: `1px solid ${surfaceBorder}`,
        backgroundColor: isLight ? 'rgba(255,255,255,0.74)' : 'rgba(16,24,34,0.58)',
        boxShadow: isLight
          ? '0 10px 26px rgba(46,83,126,0.045), inset 0 1px 0 rgba(255,255,255,0.74)'
          : 'inset 0 1px 0 rgba(255,255,255,0.035)',
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        spacing={0.85}
        alignItems="center"
        justifyContent="space-between"
        sx={{
          px: { xs: 1.05, md: 1.18 },
          py: compact ? 0.42 : 0.54,
          borderBottom: `1px solid ${surfaceBorder}`,
        }}
      >
        <Stack direction="row" spacing={0.55} alignItems="baseline" sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={{ fontSize: '0.82rem', fontWeight: 700, letterSpacing: '-0.025em' }}>
            传输
          </Typography>
          {summary.total > 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.66rem' }}>
              {summary.total} 项
            </Typography>
          ) : null}
          <Box sx={{ minWidth: 0 }}>
            {summary.latest ? (
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                title={`${summary.latest.name} · ${transferSummary(summary.latest)}`}
                sx={{ display: 'block', maxWidth: { xs: 180, md: 420 }, fontSize: '0.64rem', opacity: 0.64 }}
              >
                最近：{summary.latest.name} · {transferStatusLabel[summary.latest.status]}
              </Typography>
            ) : null}
          </Box>
        </Stack>
        <Stack direction="row" spacing={0.35} alignItems="center" useFlexGap flexWrap="wrap" sx={{ flexShrink: 0 }}>
          {stats.length > 0
            ? stats.map((stat) => (
                <Chip
                  key={stat.key}
                  size="small"
                  label={`${stat.label} ${stat.count}`}
                  sx={{
                    height: 21,
                    borderRadius: '999px',
                    border: `1px solid ${surfaceBorder}`,
                    backgroundColor:
                      stat.key === 'running'
                        ? 'var(--rterm-accent-soft)'
                        : stat.key === 'failed'
                          ? 'var(--rterm-danger-soft)'
                          : stat.key === 'done'
                            ? 'var(--rterm-success-soft)'
                            : stat.key === 'queued'
                              ? 'var(--rterm-warning-soft)'
                              : isLight
                                ? 'rgba(36,39,45,0.035)'
                                : 'rgba(255,255,255,0.025)',
                    color:
                      stat.key === 'running'
                        ? 'var(--rterm-accent)'
                        : stat.key === 'failed'
                          ? 'var(--rterm-danger)'
                          : stat.key === 'done'
                            ? 'var(--rterm-success)'
                            : stat.key === 'queued'
                              ? 'var(--rterm-warning)'
                              : 'text.secondary',
                    '& .MuiChip-label': { px: 0.68, fontSize: '0.65rem' },
                  }}
                />
              ))
            : null}
          <Tooltip title="重试失败或取消的传输">
            <span>
              <IconButton
                size="small"
                onClick={onRetryStopped}
                disabled={!hasRetryableStopped}
                sx={{
                  width: 24,
                  height: 24,
                  border: `1px solid ${surfaceBorderStrong}`,
                  color: 'var(--rterm-accent)',
                  backgroundColor: 'var(--rterm-accent-soft)',
                  '&.Mui-disabled': {
                    opacity: 0.38,
                  },
                }}
              >
                <RefreshRoundedIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="清除完成记录">
            <span>
              <IconButton
                size="small"
                onClick={onClearCompleted}
                disabled={summary.done === 0}
                sx={{
                  width: 24,
                  height: 24,
                  border: `1px solid ${surfaceBorderStrong}`,
                  color: 'var(--rterm-success)',
                  backgroundColor: 'var(--rterm-success-soft)',
                  '&.Mui-disabled': {
                    opacity: 0.38,
                  },
                }}
              >
                <CleaningServicesRoundedIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="清除失败和取消记录">
            <span>
              <IconButton
                size="small"
                onClick={onClearStopped}
                disabled={stoppedCount === 0}
                sx={{
                  width: 24,
                  height: 24,
                  border: `1px solid ${surfaceBorderStrong}`,
                  color: 'var(--rterm-danger)',
                  backgroundColor: 'var(--rterm-danger-soft)',
                  '&.Mui-disabled': {
                    opacity: 0.38,
                  },
                }}
              >
                <CloseRoundedIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      <Box sx={{ overflowX: 'auto', flex: 1, minHeight: 0 }}>
        <Box sx={{ minWidth: 930, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: transferQueueGridTemplate,
              alignItems: 'center',
              px: { xs: 0.8, md: 0.95 },
              py: 0.38,
              gap: 0.85,
              borderBottom: `1px solid ${surfaceBorder}`,
              color: mutedText,
            }}
          >
            {['文件', '方向', '来源', '目标', '大小', '进度', '速度', '状态', '操作'].map((label) => (
              <Typography
                key={label}
                variant="caption"
                sx={{ fontSize: '0.62rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}
              >
                {label}
              </Typography>
            ))}
          </Box>
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              scrollbarGutter: 'stable',
              scrollbarWidth: 'thin',
              scrollbarColor: isLight
                ? 'rgba(35,38,44,0.22) rgba(35,38,44,0.04)'
                : 'rgba(255,255,255,0.22) rgba(255,255,255,0.035)',
              '&::-webkit-scrollbar': { width: 7, height: 7 },
              '&::-webkit-scrollbar-thumb': {
                borderRadius: 999,
                backgroundColor: isLight ? 'rgba(35,38,44,0.22)' : 'rgba(255,255,255,0.22)',
              },
              '&::-webkit-scrollbar-track': {
                backgroundColor: isLight ? 'rgba(35,38,44,0.04)' : 'rgba(255,255,255,0.035)',
              },
            }}
          >
            {items.length > 0 ? (
              items.map((item) => {
                const isUpload = item.direction === 'upload';
                const progressValue =
                  item.status === 'done'
                    ? 100
                    : item.status === 'failed' || item.status === 'cancelled'
                      ? Math.max(0, Math.min(99, Math.round(item.progress || 0)))
                      : Math.max(0, Math.min(100, Math.round(item.progress || 0)));
                const statusLabel =
                  item.status === 'queued' && item.currentPath ? '准备中' : transferStatusLabel[item.status];
                const currentFile = item.currentPath ? fileNameFromPath(item.currentPath) : null;
                const detailText =
                  (item.status === 'failed' || item.status === 'cancelled') && item.errorMessage
                    ? item.errorMessage
                    : currentFile ?? transferSummary(item);

                return (
                  <Box
                    key={item.id}
                    title={`${item.sourcePath} -> ${item.targetPath}`}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: transferQueueGridTemplate,
                      alignItems: 'center',
                      px: { xs: 0.8, md: 0.95 },
                      py: 0.5,
                      gap: 0.85,
                      minHeight: 42,
                      borderBottom: `1px solid ${isLight ? 'rgba(36,39,45,0.055)' : 'rgba(255,255,255,0.035)'}`,
                      '&:hover': { backgroundColor: rowHover },
                    }}
                  >
                    <Stack direction="row" spacing={0.62} alignItems="center" sx={{ minWidth: 0 }}>
                      <Box
                        sx={{
                          width: 22,
                          height: 22,
                          borderRadius: '7px',
                          border: `1px solid ${surfaceBorder}`,
                          backgroundColor: item.kind === 'directory' ? 'var(--rterm-local-soft)' : 'var(--rterm-control-bg)',
                          display: 'grid',
                          placeItems: 'center',
                          color: item.kind === 'directory' ? 'var(--rterm-local)' : 'text.secondary',
                          flexShrink: 0,
                        }}
                      >
                        {item.kind === 'directory' ? (
                          <FolderRoundedIcon sx={{ fontSize: 14 }} />
                        ) : (
                          <ArticleRoundedIcon sx={{ fontSize: 14 }} />
                        )}
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" noWrap title={item.name} sx={{ fontSize: '0.78rem', fontWeight: 560 }}>
                          {item.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          noWrap
                          title={detailText}
                          sx={{ display: 'block', maxWidth: 250, fontSize: '0.64rem', color: mutedText }}
                        >
                          {detailText}
                        </Typography>
                      </Box>
                    </Stack>

                    <Chip
                      size="small"
                      icon={
                        isUpload ? (
                          <UploadRoundedIcon sx={{ fontSize: '0.82rem !important' }} />
                        ) : (
                          <DownloadRoundedIcon sx={{ fontSize: '0.82rem !important' }} />
                        )
                      }
                      label={isUpload ? '上传' : '下载'}
                      sx={{
                        justifySelf: 'start',
                        height: 22,
                        borderRadius: '999px',
                        border: `1px solid ${surfaceBorder}`,
                        backgroundColor: isUpload ? 'var(--rterm-remote-soft)' : 'var(--rterm-local-soft)',
                        color: isUpload ? 'var(--rterm-remote)' : 'var(--rterm-local)',
                        '& .MuiChip-label': { px: 0.55, fontSize: '0.65rem' },
                      }}
                    />

                    {renderPath(item.sourcePath)}
                    {renderPath(item.targetPath)}

                    <Typography variant="caption" noWrap sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>
                      {formatByteSize(item.size || item.bytesTransferred)}
                    </Typography>

                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={0.55} alignItems="center">
                        <Box
                          sx={{
                            flex: 1,
                            height: 5,
                            borderRadius: '999px',
                            overflow: 'hidden',
                            backgroundColor: isLight ? 'rgba(36,39,45,0.08)' : 'rgba(255,255,255,0.07)',
                          }}
                        >
                          <Box
                            sx={{
                              width: `${Math.max(item.status === 'running' ? 5 : 0, progressValue)}%`,
                              height: '100%',
                              borderRadius: '999px',
                              backgroundColor: statusColor(item.status),
                              boxShadow:
                                item.status === 'running' && !isLight
                                  ? '0 0 12px rgba(79,140,255,0.28)'
                                  : undefined,
                            }}
                          />
                        </Box>
                        <Typography variant="caption" sx={{ width: 36, textAlign: 'right', fontSize: '0.65rem', color: mutedText }}>
                          {progressValue}%
                        </Typography>
                      </Stack>
                    </Box>

                    <Typography variant="caption" noWrap sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>
                      {item.status === 'running' ? formatTransferSpeed(item.speedBytesPerSecond) : '-'}
                    </Typography>

                    <Chip
                      size="small"
                      label={statusLabel}
                      title={item.errorMessage ?? statusLabel}
                      sx={{
                        justifySelf: 'start',
                        height: 21,
                        borderRadius: '999px',
                        border: `1px solid ${surfaceBorder}`,
                        backgroundColor: statusBackground(item.status),
                        color: statusColor(item.status),
                        '& .MuiChip-label': { px: 0.62, fontSize: '0.64rem' },
                      }}
                    />

                    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                      {item.status === 'running' || item.status === 'queued' ? (
                        <Tooltip title="取消传输">
                          <IconButton
                            size="small"
                            onClick={() => onCancel(item.id)}
                            sx={{
                              width: 24,
                              height: 24,
                              border: `1px solid ${surfaceBorderStrong}`,
                              color: 'var(--rterm-danger)',
                              backgroundColor: 'var(--rterm-danger-soft)',
                            }}
                          >
                            <CloseRoundedIcon sx={{ fontSize: 13 }} />
                          </IconButton>
                        </Tooltip>
                      ) : item.status === 'failed' || item.status === 'cancelled' ? (
                        <Tooltip title="重试传输">
                          <IconButton
                            size="small"
                            onClick={() => onRetry(item.id)}
                            sx={{
                              width: 24,
                              height: 24,
                              border: `1px solid ${surfaceBorderStrong}`,
                              color: 'var(--rterm-accent)',
                              backgroundColor: 'var(--rterm-accent-soft)',
                            }}
                          >
                            <RefreshRoundedIcon sx={{ fontSize: 13 }} />
                          </IconButton>
                        </Tooltip>
                      ) : (
                        <Box sx={{ width: 24, height: 24 }} />
                      )}
                    </Box>
                  </Box>
                );
              })
            ) : (
              <EmptyStatePanel variant="queue" />
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

function RSeriesBadge() {
  return (
    <Box
      sx={{
        width: { xs: 38, md: 42 },
        height: { xs: 38, md: 42 },
        borderRadius: '12px',
        border: '1px solid var(--rterm-accent-border)',
        backgroundColor: (theme) => (theme.palette.mode === 'light' ? 'rgba(255,255,255,0.92)' : 'rgba(16,24,34,0.82)'),
        boxShadow: (theme) =>
          theme.palette.mode === 'light'
            ? '0 10px 24px rgba(46,83,126,0.08), inset 0 1px 0 rgba(255,255,255,0.86)'
            : 'inset 0 1px 0 rgba(255,255,255,0.06)',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <Box
        sx={{
          width: { xs: 24, md: 26 },
          height: { xs: 24, md: 26 },
          borderRadius: '8px',
          backgroundColor: (theme) => (theme.palette.mode === 'light' ? 'var(--rterm-accent)' : '#c8d9ff'),
          color: (theme) => (theme.palette.mode === 'light' ? '#f8fbff' : '#0a1220'),
          display: 'grid',
          placeItems: 'center',
          fontSize: { xs: '1.08rem', md: '1.18rem' },
          fontWeight: 500,
          lineHeight: 1,
          letterSpacing: '-0.04em',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.48), 0 0 0 1px var(--rterm-accent-border)',
        }}
      >
        R
      </Box>
    </Box>
  );
}

function FavoriteHostStatusBadge({ state, selected }: { state: FavoriteHostConnectionState; selected: boolean }) {
  const muiTheme = useTheme();
  const isLight = muiTheme.palette.mode === 'light';
  const stateColor =
    state === 'connected'
      ? isLight
        ? 'rgba(24,142,88,0.92)'
        : 'rgba(101,221,142,0.94)'
      : state === 'running'
        ? isLight
          ? 'rgba(19,126,86,0.9)'
          : 'rgba(112,232,159,0.95)'
        : state === 'connecting'
          ? isLight
            ? 'rgba(169,112,24,0.86)'
            : 'rgba(246,197,104,0.92)'
          : state === 'ready'
            ? isLight
              ? 'rgba(31,34,39,0.42)'
              : 'rgba(255,255,255,0.42)'
            : isLight
              ? 'rgba(190,76,76,0.68)'
              : 'rgba(255,157,157,0.68)';
  const iconSx = {
    fontSize: selected ? 13.4 : 13,
    color: stateColor,
  };

  const icon =
    state === 'running' ? (
      <TerminalRoundedIcon sx={iconSx} />
    ) : state === 'connected' ? (
      <LinkRoundedIcon sx={iconSx} />
    ) : state === 'connecting' ? (
      <SyncRoundedIcon sx={iconSx} />
    ) : state === 'ready' ? (
      <PowerSettingsNewRoundedIcon sx={{ ...iconSx, fontSize: 12.6 }} />
    ) : (
      <ErrorOutlineRoundedIcon sx={iconSx} />
    );

  return (
    <Box
      aria-hidden
      sx={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        backgroundColor: 'transparent',
        boxShadow: 'none',
        flexShrink: 0,
        '& svg': {
          display: 'block',
        },
        ...(state === 'connecting'
          ? {
              animation: 'rterm-favorite-spin 920ms linear infinite',
            }
          : null),
      }}
    >
      {icon}
    </Box>
  );
}

function FavoriteHostStrip({
  favorites,
  activeConnection,
  favoriteConnectionStateById,
  favoriteRemotePoolSummaryById,
  selectedFavoriteId,
  isOpeningConnection,
  openingConnectionId,
  onSelectFavoriteTab,
  onOpenFavoriteConfig,
  onRenameFavoriteTab,
  onRemoveFavoriteTab,
  onCloseFavoriteTerminal,
  onDisconnectFavoriteConnection,
  onOpenFavoriteDirectory,
}: {
  favorites: FavoriteItem[];
  activeConnection: ConnectionDraft | null;
  favoriteConnectionStateById: Record<string, FavoriteHostConnectionState>;
  favoriteRemotePoolSummaryById: Record<string, RemotePoolFavoriteSummary>;
  selectedFavoriteId: string | null;
  isOpeningConnection: boolean;
  openingConnectionId: string | null;
  onSelectFavoriteTab: (favorite: FavoriteItem) => void;
  onOpenFavoriteConfig: (favorite: FavoriteItem) => void;
  onRenameFavoriteTab: (favorite: FavoriteItem) => void;
  onRemoveFavoriteTab: (favorite: FavoriteItem) => void;
  onCloseFavoriteTerminal: (favorite: FavoriteItem) => void;
  onDisconnectFavoriteConnection: (favorite: FavoriteItem) => void;
  onOpenFavoriteDirectory: (favorite: FavoriteItem, path: string) => void;
}) {
  const [menuFavorite, setMenuFavorite] = useState<FavoriteItem | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const tabClickTimerRef = useRef<number | null>(null);
  const muiTheme = useTheme();
  const isLight = muiTheme.palette.mode === 'light';
  const tabBorder = isLight ? 'rgba(30,32,37,0.08)' : 'rgba(255,255,255,0.07)';
  const tabBorderStrong = isLight ? 'rgba(30,32,37,0.12)' : 'rgba(255,255,255,0.16)';
  const tabActiveBorder = isLight ? 'rgba(21,24,29,0.24)' : 'rgba(245,243,238,0.28)';
  const tabSelectedBg = isLight ? 'rgba(255,255,255,0.9)' : 'rgba(245,243,238,0.105)';
  const tabActiveBg = isLight ? 'rgba(255,255,255,0.46)' : 'rgba(255,255,255,0.046)';
  const tabHoverBg = isLight ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.08)';
  const tabSelectedShadow = isLight
    ? '0 4px 10px rgba(31,34,39,0.085), 0 1px 3px rgba(31,34,39,0.05), inset 0 1px 0 rgba(255,255,255,0.88)'
    : '0 4px 12px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.07)';
  const tabFocusShadow = isLight ? '0 0 0 2px rgba(31,34,39,0.1)' : '0 0 0 2px rgba(245,243,238,0.16)';
  const clearPendingTabClick = () => {
    if (tabClickTimerRef.current === null) {
      return;
    }

    window.clearTimeout(tabClickTimerRef.current);
    tabClickTimerRef.current = null;
  };

  useEffect(() => clearPendingTabClick, []);

  if (favorites.length === 0) {
    return null;
  }

  const closeMenu = () => {
    setMenuFavorite(null);
    setMenuPosition(null);
  };
  const menuFavoriteState = menuFavorite ? favoriteConnectionStateById[menuFavorite.id] ?? 'incomplete' : null;
  const canDisconnectMenuFavorite = menuFavoriteState === 'connected' || menuFavoriteState === 'running';
  const menuPoolSummary = menuFavorite ? favoriteRemotePoolSummaryById[menuFavorite.id] : null;

  return (
    <>
      <Stack
        direction="row"
        spacing={0.45}
        alignItems="center"
        sx={{
          minWidth: 0,
          flex: 1,
          '@keyframes rterm-favorite-spin': {
            from: { transform: 'rotate(0deg)' },
            to: { transform: 'rotate(360deg)' },
          },
        }}
      >
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
            pr: 0.2,
            maskImage: 'linear-gradient(90deg, transparent 0, #000 8px, #000 calc(100% - 14px), transparent 100%)',
            '&::-webkit-scrollbar': {
              height: 3,
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: 'transparent',
              borderRadius: 999,
            },
            '&:hover::-webkit-scrollbar-thumb': {
              backgroundColor: isLight ? 'rgba(31,34,39,0.22)' : 'rgba(255,255,255,0.12)',
            },
          }}
        >
          <Stack direction="row" spacing={0.42} sx={{ width: 'max-content', minWidth: '100%', alignItems: 'center' }}>
            {favorites.map((favorite) => {
              const isActive =
                activeConnection?.host === favorite.host &&
                (activeConnection?.port || '') === (favorite.port == null ? '' : String(favorite.port)) &&
                activeConnection?.path === favorite.path;
              const isSelected = selectedFavoriteId === favorite.id || (!selectedFavoriteId && isActive);
              const isPending = isOpeningConnection && openingConnectionId === `favorite:${favorite.id}`;
              const favoriteState = isPending
                ? 'connecting'
                : favoriteConnectionStateById[favorite.id] ?? 'incomplete';
              const poolSummary = favoriteRemotePoolSummaryById[favorite.id];
              const poolLabel = remotePoolSummaryLabel(poolSummary);
              const stateLabel =
                favoriteState === 'connecting'
                  ? '连接中'
                  : favoriteState === 'running'
                    ? '终端运行中'
                    : favoriteState === 'connected'
                      ? '已连接'
                      : favoriteState === 'ready'
                        ? '可连接'
                        : '待补全配置';
              const clickActionLabel =
                favoriteState === 'connected' || favoriteState === 'running'
                  ? '单击切换，双击打开远端文件夹'
                  : '单击切换，双击连接远端文件夹';
              const handleTabClick = () => {
                if (isOpeningConnection) {
                  return;
                }

                clearPendingTabClick();
                tabClickTimerRef.current = window.setTimeout(() => {
                  tabClickTimerRef.current = null;
                  onSelectFavoriteTab(favorite);
                }, 160);
              };

              return (
                <Tooltip
                  key={favorite.id}
                  title={`${favorite.name} · ${connectionEndpoint(favorite.host, favorite.port)} · ${stateLabel} · ${poolLabel} · ${clickActionLabel}，右键更多操作`}
                >
                  <Box
                    component="button"
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    aria-label={`${favorite.name || connectionEndpoint(favorite.host, favorite.port)}，${stateLabel}`}
                    onClick={handleTabClick}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (isOpeningConnection) {
                        return;
                      }

                      clearPendingTabClick();
                      onOpenFavoriteDirectory(favorite, favorite.path);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenuFavorite(favorite);
                      setMenuPosition({
                        top: event.clientY + 4,
                        left: event.clientX + 2,
                      });
                    }}
                    sx={{
                      position: 'relative',
                      appearance: 'none',
                      font: 'inherit',
                      px: 0.58,
                      py: 0,
                      height: 29,
                      borderRadius: '999px',
                      border: `1px solid ${isSelected || isActive ? tabBorderStrong : 'transparent'}`,
                      backgroundColor: isSelected
                        ? tabSelectedBg
                        : isActive
                          ? tabActiveBg
                          : 'transparent',
                      color: isSelected || isActive ? 'text.primary' : 'text.secondary',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.34,
                      cursor: isOpeningConnection ? 'progress' : 'pointer',
                      outline: 'none',
                      transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease',
                      boxShadow: isSelected ? tabSelectedShadow : 'none',
                      '&:focus': {
                        outline: 'none',
                      },
                      '&:focus-visible': {
                        borderColor: tabActiveBorder,
                        boxShadow: isSelected ? `${tabFocusShadow}, ${tabSelectedShadow}` : tabFocusShadow,
                      },
                      '&:hover': isOpeningConnection
                        ? undefined
                        : {
                            borderColor: tabBorder,
                            backgroundColor: tabHoverBg,
                          },
                    }}
                  >
                    <FavoriteHostStatusBadge state={favoriteState} selected={isSelected} />
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: '0.77rem',
                        lineHeight: 1.1,
                        maxWidth: 124,
                        fontWeight: 680,
                        letterSpacing: 0,
                      }}
                      noWrap
                    >
                      {favorite.name || connectionEndpoint(favorite.host, favorite.port)}
                    </Typography>
                    {poolSummary?.connected ? (
                      <Typography
                        variant="caption"
                        sx={{
                          minWidth: 14,
                          height: 14,
                          px: 0.32,
                          borderRadius: '7px',
                          display: 'grid',
                          placeItems: 'center',
                          fontSize: '0.58rem',
                          fontWeight: 760,
                          lineHeight: 1,
                          color: isLight ? 'rgba(20,122,79,0.92)' : 'rgba(112,232,159,0.95)',
                          backgroundColor: isLight ? 'rgba(24,142,88,0.08)' : 'rgba(112,232,159,0.08)',
                        }}
                      >
                        {poolSummary.connected}
                      </Typography>
                    ) : null}
                  </Box>
                </Tooltip>
              );
            })}
          </Stack>
        </Box>
      </Stack>
      <Menu
        open={Boolean(menuFavorite)}
        onClose={closeMenu}
        anchorReference="anchorPosition"
        anchorPosition={menuPosition ?? undefined}
        PaperProps={{
          sx: {
            minWidth: 180,
          },
        }}
      >
        <MenuItem
          onClick={() => {
            if (menuFavorite) {
              onOpenFavoriteDirectory(menuFavorite, menuFavorite.path);
            }
            closeMenu();
          }}
          disabled={!menuFavorite || isOpeningConnection}
        >
          连接远端文件夹
        </MenuItem>
        {menuFavorite ? (
          <MenuItem disabled>
            <Stack spacing={0.15} sx={{ minWidth: 0 }}>
              <Typography variant="body2">连接池：{menuPoolSummary?.connected ?? 0}/{menuPoolSummary?.total ?? 0}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                最近使用：{formatPoolTimestamp(menuPoolSummary?.latest?.lastUsedAt)}
              </Typography>
            </Stack>
          </MenuItem>
        ) : null}
        {menuFavorite && canDisconnectMenuFavorite ? (
          <MenuItem
            onClick={() => {
              if (menuFavorite) {
                onDisconnectFavoriteConnection(menuFavorite);
              }
              closeMenu();
            }}
          >
            断开连接
          </MenuItem>
        ) : null}
        {menuFavorite && favoriteConnectionStateById[menuFavorite.id] === 'running' ? (
          <MenuItem
            onClick={() => {
              if (menuFavorite) {
                onCloseFavoriteTerminal(menuFavorite);
              }
              closeMenu();
            }}
          >
            关闭终端
          </MenuItem>
        ) : null}
        <MenuItem
          onClick={() => {
            if (menuFavorite) {
              onOpenFavoriteConfig(menuFavorite);
            }
            closeMenu();
          }}
        >
          配置连接...
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuFavorite) {
              onRenameFavoriteTab(menuFavorite);
            }
            closeMenu();
          }}
        >
          重命名...
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuFavorite) {
              onRemoveFavoriteTab(menuFavorite);
            }
            closeMenu();
          }}
        >
          删除
        </MenuItem>
      </Menu>
    </>
  );
}

function TerminalPanel({
  directory,
  label,
  canUseRemote,
  history,
  entries,
  favorites,
  completionConfig,
  targetProfile,
  sessionId,
  output,
  isRunning,
  isStarting,
  onStartSession,
  onStopSession,
  onSendInput,
  onTerminalDebug,
  onClearHistory,
  onCloseDialog,
}: {
  directory: string;
  label: string;
  canUseRemote: boolean;
  history: TerminalHistoryEntry[];
  entries: DirectoryEntry[];
  favorites: FavoriteItem[];
  completionConfig: TerminalCompletionConfig;
  targetProfile: TerminalProfile;
  sessionId: string | null;
  output: string;
  isRunning: boolean;
  isStarting: boolean;
  onStartSession: () => void;
  onStopSession: () => void;
  onSendInput: (input: string, raw?: boolean) => void;
  onTerminalDebug?: (message: string) => void;
  onClearHistory: () => void;
  onCloseDialog: () => void;
}) {
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const writtenOutputLengthRef = useRef(0);
  const sendInputRef = useRef(onSendInput);
  const sessionIdRef = useRef(sessionId);
  const inputBufferRef = useRef('');
  const completionConfigRef = useRef(completionConfig);
  const activeSuggestionRef = useRef<TerminalCompletionSuggestion | null>(null);
  const inputBufferFrameRef = useRef<number | null>(null);
  const terminalSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const [inputBuffer, setInputBuffer] = useState('');
  const [sessionCommands, setSessionCommands] = useState<string[]>([]);
  const supportsPtySession = canUseRemote;
  const shouldUseXterm = Boolean(sessionId || output);
  const muiTheme = useTheme();
  const terminalLight = muiTheme.palette.mode === 'light';
  const terminalBorder = terminalLight ? 'rgba(31,34,39,0.16)' : 'rgba(255,255,255,0.1)';
  const terminalBorderStrong = terminalLight ? 'rgba(31,34,39,0.28)' : 'rgba(255,255,255,0.16)';
  const terminalControlBg = terminalLight ? 'rgba(31,34,39,0.055)' : 'rgba(255,255,255,0.02)';
  const terminalControlActiveBg = terminalLight ? 'rgba(31,34,39,0.12)' : 'rgba(255,255,255,0.08)';
  const terminalDisabledColor = terminalLight ? 'rgba(31,34,39,0.42)' : 'rgba(255,255,255,0.34)';
  const terminalTextColor = terminalLight ? 'rgba(21,24,29,0.88)' : 'rgba(245,243,238,0.84)';
  const terminalMutedText = terminalLight ? 'rgba(31,34,39,0.56)' : 'rgba(255,255,255,0.42)';
  const terminalWindowBg = terminalLight ? 'rgba(251,253,255,0.98)' : 'rgba(9,14,22,0.96)';
  const terminalHeaderBg = terminalLight ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.026)';
  const terminalViewportBg = terminalLight ? '#fbfcff' : '#050a11';
  const terminalStatusLabel = sessionId ? '运行中' : isStarting ? '启动中' : supportsPtySession ? '就绪' : '未连接';
  const terminalStatusColor = sessionId
    ? 'var(--rterm-success)'
    : isStarting
      ? 'var(--rterm-warning)'
      : supportsPtySession
        ? 'var(--rterm-accent)'
        : terminalMutedText;
  const terminalStatusBg = sessionId
    ? 'var(--rterm-success-soft)'
    : isStarting
      ? 'var(--rterm-warning-soft)'
      : supportsPtySession
        ? 'var(--rterm-accent-soft)'
        : terminalControlBg;
  const terminalPathLabel = directory.trim() || '~';
  const terminalTitleLabel = label.trim() || '远端终端';
  const xtermTheme = terminalLight
    ? {
        background: terminalViewportBg,
        foreground: '#172133',
        cursor: '#2563eb',
        selectionBackground: '#d7e4ff',
        black: '#1d2026',
        brightBlack: '#777d89',
        red: '#b84a55',
        brightRed: '#d15b66',
        green: '#3f7f54',
        brightGreen: '#4f9866',
        yellow: '#9a6b1f',
        brightYellow: '#b7812c',
        blue: '#3f65b7',
        brightBlue: '#5479d2',
        magenta: '#7a529f',
        brightMagenta: '#9166ba',
        cyan: '#3d7b88',
        brightCyan: '#4e97a8',
        white: '#e9e2d8',
        brightWhite: '#fffaf4',
      }
    : {
        background: terminalViewportBg,
        foreground: '#e8edf5',
        cursor: '#7aa2ff',
        selectionBackground: '#25344f',
        black: '#0c0d10',
        brightBlack: '#666b73',
        red: '#e06c75',
        brightRed: '#ff7b86',
        green: '#98c379',
        brightGreen: '#b6e38d',
        yellow: '#d6b56d',
        brightYellow: '#ffd17b',
        blue: '#7aa2f7',
        brightBlue: '#96b6ff',
        magenta: '#c792ea',
        brightMagenta: '#d8a8ff',
        cyan: '#89ddff',
        brightCyan: '#a4e9ff',
        white: '#d7d4cf',
        brightWhite: '#ffffff',
      };

  const updateInputBuffer = (nextInput: string) => {
    inputBufferRef.current = nextInput.slice(-240);
    if (inputBufferFrameRef.current !== null) {
      return;
    }

    inputBufferFrameRef.current = window.requestAnimationFrame(() => {
      inputBufferFrameRef.current = null;
      setInputBuffer(inputBufferRef.current);
    });
  };

  const rememberSessionCommand = (command: string) => {
    setSessionCommands((current) => {
      const normalizedCommand = command.trim();
      if (!normalizedCommand) {
        return current;
      }

      return [normalizedCommand, ...current.filter((item) => item !== normalizedCommand)].slice(0, 24);
    });
  };

  const suggestions = useMemo(
    () =>
      buildTerminalCompletionSuggestions({
        input: inputBuffer,
        config: completionConfig,
        history,
        sessionCommands,
        directory,
        targetProfile,
        entries,
        favorites,
      }),
    [completionConfig, directory, entries, favorites, history, inputBuffer, sessionCommands, targetProfile],
  );
  const activeSuggestion = suggestions[0] ?? null;
  const acceptKeyLabel = terminalCompletionAcceptKeyLabel(completionConfig);
  const suggestionPreview = activeSuggestion
    ? applyTerminalCompletionSuggestion(inputBuffer, activeSuggestion)
    : '';

  const acceptActiveSuggestion = () => {
    const suggestion = activeSuggestionRef.current;
    if (!suggestion || !sessionId) {
      return false;
    }

    const currentInput = inputBufferRef.current;
    const input = buildTerminalCompletionAcceptInput(currentInput, suggestion);
    if (!input) {
      return false;
    }

    sendInputRef.current(input, true);
    updateInputBuffer(applyTerminalCompletionSuggestion(currentInput, suggestion));
    onTerminalDebug?.(`[ui.completion.accept] ${suggestion.source}:${suggestion.label}`);
    requestAnimationFrame(() => xtermRef.current?.focus());
    return true;
  };

  const focusTerminal = () => {
    const terminal = xtermRef.current;
    if (!terminal) {
      return;
    }

    terminal.focus();
    const helperTextarea = terminalHostRef.current?.querySelector('textarea');
    if (helperTextarea instanceof HTMLTextAreaElement) {
      helperTextarea.focus({ preventScroll: true });
      onTerminalDebug?.('[ui.focus] 已尝试聚焦 xterm helper textarea');
    } else {
      onTerminalDebug?.('[ui.focus.miss] 未找到 xterm helper textarea');
    }
  };

  const closeTerminalAndDialog = () => {
    if (sessionId) {
      onStopSession();
    }
    onCloseDialog();
  };

  useEffect(() => {
    sendInputRef.current = onSendInput;
  }, [onSendInput]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
    if (xtermRef.current) {
      xtermRef.current.options.disableStdin = !sessionId;
    }
  }, [sessionId]);

  useEffect(() => {
    completionConfigRef.current = completionConfig;
  }, [completionConfig]);

  useEffect(() => {
    activeSuggestionRef.current = activeSuggestion;
  }, [activeSuggestion]);

  useEffect(
    () => () => {
      if (inputBufferFrameRef.current !== null) {
        window.cancelAnimationFrame(inputBufferFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const viewport = terminalHostRef.current?.querySelector('.xterm-viewport');
    if (viewport instanceof HTMLElement) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [history, isRunning, output, sessionId]);

  useEffect(() => {
    if (!shouldUseXterm || !terminalHostRef.current) {
      return undefined;
    }

    const hostElement = terminalHostRef.current;
    const resizeToHost = () => {
      const terminal = xtermRef.current;
      if (!terminal) {
        return;
      }

      const width = hostElement.clientWidth;
      const height = hostElement.clientHeight;
      if (width <= 0 || height <= 0) {
        return;
      }

      const cols = Math.max(20, Math.floor((width - 8) / 7.25));
      const rows = Math.max(6, Math.floor((height - 8) / (12 * 1.35)));
      const previousSize = terminalSizeRef.current;
      if (previousSize?.cols === cols && previousSize.rows === rows) {
        return;
      }

      terminalSizeRef.current = { cols, rows };
      terminal.resize(cols, rows);
      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        void resizeTerminalSession(currentSessionId, { cols, rows }).catch(() => undefined);
      }
    };

    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      rows: 24,
      cols: 100,
      convertEol: true,
      disableStdin: !sessionId,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      scrollback: 3000,
      theme: xtermTheme,
    });

    terminal.open(hostElement);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') {
        return true;
      }

      if (shouldAcceptTerminalCompletion(event, completionConfigRef.current) && activeSuggestionRef.current) {
        return !acceptActiveSuggestion();
      }

      if (event.ctrlKey && event.shiftKey) {
        const key = event.key.toLowerCase();
        if (key === 'v') {
          void navigator.clipboard
            .readText()
            .then((text) => {
              if (text) {
                sendInputRef.current(text, true);
              }
            })
            .catch(() => undefined);
          return false;
        }

        if (key === 'c' || key === 'x') {
          const selectedText = terminal.getSelection();
          if (selectedText) {
            void navigator.clipboard.writeText(selectedText).catch(() => undefined);
          }
          requestAnimationFrame(() => terminal.focus());
          return false;
        }
      }

      return true;
    });
    xtermRef.current = terminal;
    writtenOutputLengthRef.current = 0;
    resizeToHost();
    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(resizeToHost);
    });
    resizeObserver.observe(hostElement);
    requestAnimationFrame(() => {
      resizeToHost();
      focusTerminal();
    });

    const dataSubscription = terminal.onData((data) => {
      if (!sessionIdRef.current) {
        return;
      }

      onTerminalDebug?.(`[ui.onData] 收到按键数据，${data.length} bytes`);
      const submittedCommand = recordSubmittedTerminalCommand(inputBufferRef.current, data);
      if (submittedCommand) {
        rememberSessionCommand(submittedCommand);
      }
      updateInputBuffer(nextTerminalCompletionInput(inputBufferRef.current, data));
      sendInputRef.current(data, true);
    });

    return () => {
      resizeObserver.disconnect();
      dataSubscription.dispose();
      terminal.dispose();
      xtermRef.current = null;
      writtenOutputLengthRef.current = 0;
      terminalSizeRef.current = null;
      updateInputBuffer('');
    };
  }, [sessionId, shouldUseXterm, terminalLight]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    requestAnimationFrame(() => {
      focusTerminal();
    });
  }, [sessionId, output]);

  useEffect(() => {
    const terminal = xtermRef.current;
    if (!terminal || !shouldUseXterm) {
      return;
    }

    if (output.length < writtenOutputLengthRef.current) {
      terminal.clear();
      writtenOutputLengthRef.current = 0;
    }

    const nextChunk = output.slice(writtenOutputLengthRef.current);
    if (!nextChunk) {
      return;
    }

    terminal.write(nextChunk);
    writtenOutputLengthRef.current = output.length;
  }, [output, shouldUseXterm]);

  return (
    <Box
      sx={{
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: terminalWindowBg,
        '@keyframes rterm-terminal-cursor': {
          '0%, 48%': { opacity: 1 },
          '49%, 100%': { opacity: 0 },
        },
      }}
    >
      <Box
        sx={{
          minHeight: 58,
          px: { xs: 1.05, md: 1.25 },
          py: 0.82,
          borderBottom: `1px solid ${terminalBorder}`,
          backgroundColor: terminalHeaderBg,
          display: 'flex',
          alignItems: 'center',
          gap: 0.95,
        }}
      >
        <Box
          sx={{
            width: 34,
            height: 34,
            borderRadius: '10px',
            border: `1px solid ${terminalBorderStrong}`,
            backgroundColor: 'var(--rterm-accent-soft)',
            color: 'var(--rterm-accent)',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          <TerminalRoundedIcon sx={{ fontSize: 18 }} />
        </Box>
        <Stack spacing={0.18} sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.7} alignItems="center" sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={760} noWrap sx={{ letterSpacing: 0, lineHeight: 1.1 }}>
              终端
            </Typography>
            <Chip
              size="small"
              label={terminalStatusLabel}
              sx={{
                height: 21,
                borderRadius: '999px',
                border: `1px solid ${terminalBorder}`,
                backgroundColor: terminalStatusBg,
                color: terminalStatusColor,
                '& .MuiChip-label': { px: 0.7, fontSize: '0.64rem', fontWeight: 720 },
              }}
            />
          </Stack>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            title={`${terminalTitleLabel} · ${terminalPathLabel}`}
            sx={{ fontSize: '0.72rem', lineHeight: 1.25 }}
          >
            {terminalTitleLabel} · {terminalPathLabel}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.42} alignItems="center" sx={{ flexShrink: 0 }}>
          {!sessionId ? (
            <Tooltip title={supportsPtySession ? '启动远端 SSH shell' : '请选择 SFTP/SCP 主机'}>
              <span>
                <IconButton
                  size="small"
                  onClick={onStartSession}
                  disabled={isStarting || !supportsPtySession}
                  sx={{
                    width: 34,
                    height: 34,
                    border: `1px solid ${terminalBorderStrong}`,
                    backgroundColor: supportsPtySession ? 'var(--rterm-accent-soft)' : terminalControlBg,
                    color: supportsPtySession ? 'var(--rterm-accent)' : terminalDisabledColor,
                    '&:hover': {
                      borderColor: 'var(--rterm-accent-border)',
                      backgroundColor: terminalControlActiveBg,
                    },
                    '&.Mui-disabled': {
                      color: terminalDisabledColor,
                    },
                  }}
                >
                  <PlayArrowRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </span>
            </Tooltip>
          ) : null}
          <Tooltip title="清空终端输出">
            <span>
              <IconButton
                size="small"
                onClick={onClearHistory}
                disabled={isRunning || (!output && history.length === 0)}
                sx={{
                  width: 34,
                  height: 34,
                  border: `1px solid ${terminalBorder}`,
                  backgroundColor: terminalControlBg,
                  color: 'text.primary',
                  '&:hover': {
                    borderColor: terminalBorderStrong,
                    backgroundColor: terminalControlActiveBg,
                  },
                  '&.Mui-disabled': {
                    color: terminalDisabledColor,
                  },
                }}
              >
                <CleaningServicesRoundedIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={sessionId ? '关闭终端并收起窗口' : '收起终端窗口'}>
            <span>
              <IconButton
                size="small"
                onClick={closeTerminalAndDialog}
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  backgroundColor: terminalLight ? 'rgba(31,34,39,0.05)' : 'rgba(255,255,255,0.055)',
                  color: terminalLight ? 'rgba(31,34,39,0.76)' : 'rgba(245,243,238,0.82)',
                  '&:hover': {
                    backgroundColor: terminalLight ? 'rgba(31,34,39,0.1)' : 'rgba(255,255,255,0.1)',
                  },
                }}
                aria-label={sessionId ? '关闭终端并收起窗口' : '收起终端窗口'}
              >
                <CloseRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      </Box>

      <Stack spacing={0.5} sx={{ flex: 1, minHeight: 0, p: { xs: 0.72, md: 0.82 } }}>
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            borderRadius: '13px',
            border: `1px solid ${terminalBorderStrong}`,
            backgroundColor: terminalViewportBg,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: terminalLight
              ? 'inset 0 1px 0 rgba(255,255,255,0.86)'
              : 'inset 0 1px 0 rgba(255,255,255,0.045)',
          }}
        >
          <Stack
            direction="row"
            spacing={0.65}
            alignItems="center"
            sx={{
              minHeight: 32,
              px: 0.82,
              borderBottom: `1px solid ${terminalBorder}`,
              backgroundColor: terminalLight ? 'rgba(31,34,39,0.025)' : 'rgba(255,255,255,0.018)',
            }}
          >
            <Stack direction="row" spacing={0.38} aria-hidden>
              {['var(--rterm-danger)', 'var(--rterm-warning)', 'var(--rterm-success)'].map((color) => (
                <Box
                  key={color}
                  sx={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    backgroundColor: color,
                    opacity: terminalLight ? 0.56 : 0.68,
                  }}
                />
              ))}
            </Stack>
            <Typography
              variant="caption"
              noWrap
              title={terminalPathLabel}
              sx={{
                flex: 1,
                minWidth: 0,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '0.68rem',
                color: terminalMutedText,
              }}
            >
              {terminalPathLabel}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                flexShrink: 0,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '0.64rem',
                color: terminalMutedText,
              }}
            >
              {targetProfile}
            </Typography>
          </Stack>

          <Box
            onMouseDown={(event) => {
              if (!sessionId) {
                return;
              }

              requestAnimationFrame(() => {
                focusTerminal();
              });
            }}
            onClick={() => {
              onTerminalDebug?.('[ui.click] 点击了终端黑色区域');
              focusTerminal();
            }}
            sx={{
              flex: 1,
              minHeight: 0,
              height: 0,
              overflow: sessionId ? 'hidden' : 'auto',
              position: 'relative',
              isolation: 'isolate',
              zIndex: 0,
              p: { xs: 0.8, md: 0.9 },
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              cursor: sessionId ? 'text' : 'default',
              outline: 'none',
              '&::-webkit-scrollbar': {
                width: 6,
              },
              '&::-webkit-scrollbar-thumb': {
                backgroundColor: terminalLight ? 'rgba(31,34,39,0.24)' : 'rgba(255,255,255,0.12)',
                borderRadius: 999,
              },
            }}
          >
          {shouldUseXterm ? (
            <Box
              ref={terminalHostRef}
              sx={{
                height: '100%',
                minHeight: 0,
                width: '100%',
                position: 'relative',
                overflow: 'hidden',
                '& .xterm': {
                  height: '100%',
                  width: '100%',
                  position: 'relative',
                  overflow: 'hidden',
                },
                '& .xterm-viewport': {
                  backgroundColor: 'transparent !important',
                },
                '& .xterm-screen': {
                  outline: 'none',
                },
              }}
            />
          ) : history.length === 0 ? (
            <Typography component="div" sx={{ fontFamily: 'inherit', fontSize: '0.78rem', color: terminalTextColor }}>
              <Box component="span" sx={{ color: terminalMutedText }}>
                {terminalPathLabel}
              </Box>{' '}
              <Box component="span" sx={{ color: terminalLight ? 'rgba(31,34,39,0.7)' : 'rgba(255,255,255,0.62)' }}>
                $
              </Box>{' '}
              <Box
                component="span"
                sx={{
                  display: 'inline-block',
                  width: 7,
                  height: 17,
                  mb: '-3px',
                  borderLeft: `2px solid ${terminalLight ? '#172133' : '#e8edf5'}`,
                  animation: 'rterm-terminal-cursor 1s steps(1) infinite',
                }}
              />
            </Typography>
          ) : (
            <Stack spacing={0.95}>
              {history.map((entry) => {
                const hasOutput = Boolean(entry.stdout || entry.stderr);

                return (
                  <Box key={entry.id}>
                    <Typography
                      component="div"
                      sx={{
                        fontFamily: 'inherit',
                        fontSize: '0.74rem',
                        color: terminalLight ? 'rgba(21,24,29,0.92)' : 'rgba(245,243,238,0.92)',
                      }}
                    >
                      <Box component="span" sx={{ color: terminalMutedText }}>
                        {entry.currentDirectory}
                      </Box>{' '}
                      <Box component="span" sx={{ color: terminalLight ? 'rgba(31,34,39,0.7)' : 'rgba(255,255,255,0.62)' }}>
                        $
                      </Box>{' '}
                      {entry.command}
                    </Typography>
                    {hasOutput ? (
                      <Box sx={{ mt: 0.3 }}>
                        {entry.stdout ? (
                          <Typography
                            component="pre"
                            sx={{
                              m: 0,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              fontFamily: 'inherit',
                              fontSize: '0.73rem',
                              lineHeight: 1.55,
                              color: terminalTextColor,
                            }}
                          >
                            {entry.stdout}
                          </Typography>
                        ) : null}
                        {entry.stderr ? (
                          <Typography
                            component="pre"
                            sx={{
                              m: 0,
                              mt: entry.stdout ? 0.25 : 0,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              fontFamily: 'inherit',
                              fontSize: '0.73rem',
                              lineHeight: 1.55,
                              color: terminalLight ? 'rgba(31,34,39,0.62)' : 'rgba(255,255,255,0.54)',
                            }}
                          >
                            {entry.stderr}
                          </Typography>
                        ) : null}
                      </Box>
                    ) : null}
                    {entry.exitCode !== 0 ? (
                      <Typography
                        variant="caption"
                        sx={{
                          display: 'block',
                          mt: 0.25,
                          fontFamily: 'inherit',
                          fontSize: '0.68rem',
                          color: terminalMutedText,
                        }}
                      >
                        退出码 {entry.exitCode}
                      </Typography>
                    ) : null}
                  </Box>
                );
              })}
              {isRunning ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontFamily: 'inherit', fontSize: '0.72rem' }}
                >
                  正在执行...
                </Typography>
              ) : null}
            </Stack>
          )}
        </Box>
        </Box>

        {sessionId && activeSuggestion ? (
          <Box
            onMouseDown={(event) => {
              event.preventDefault();
              acceptActiveSuggestion();
            }}
            sx={{
              minHeight: 28,
              px: 0.75,
              py: 0.35,
              borderRadius: '10px',
              border: `1px solid ${terminalBorder}`,
              backgroundColor: terminalLight ? 'rgba(31,34,39,0.045)' : 'rgba(255,255,255,0.025)',
              display: 'flex',
              alignItems: 'center',
              gap: 0.7,
              cursor: 'pointer',
              overflow: 'hidden',
            }}
          >
            <Typography
              variant="caption"
              sx={{
                flex: 1,
                minWidth: 0,
                color: terminalTextColor,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '0.68rem',
              }}
              noWrap
            >
              <Box component="span" sx={{ color: terminalMutedText }}>
                {activeSuggestion.source}
              </Box>{' '}
              {suggestionPreview}
            </Typography>
            <Chip
              size="small"
              label={acceptKeyLabel}
              sx={{
                height: 20,
                borderRadius: '8px',
                border: `1px solid ${terminalBorderStrong}`,
                backgroundColor: terminalControlBg,
                color: 'text.secondary',
                flexShrink: 0,
                '& .MuiChip-label': {
                  px: 0.65,
                  fontSize: '0.62rem',
                },
              }}
            />
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}

function CollapsedPanelBar({
  title,
  icon,
  primary,
  secondary,
  status,
  onExpand,
}: {
  title: string;
  icon: ReactNode;
  primary: string;
  secondary?: string;
  status?: string;
  onExpand: () => void;
}) {
  const muiTheme = useTheme();
  const isLight = muiTheme.palette.mode === 'light';
  const panelBorder = isLight ? 'rgba(31,34,39,0.16)' : 'rgba(255,255,255,0.075)';
  const panelBg = isLight
    ? 'linear-gradient(180deg, rgba(255,255,255,0.88), rgba(248,244,237,0.78))'
    : 'linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.014))';
  const controlBg = isLight ? 'rgba(31,34,39,0.055)' : 'rgba(255,255,255,0.03)';

  return (
    <Box
      sx={{
        width: '100%',
        minHeight: 48,
        minWidth: 0,
        px: { xs: 0.78, md: 0.9 },
        py: 0.5,
        borderRadius: '13px',
        border: `1px solid ${panelBorder}`,
        background: panelBg,
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          width: 24,
          height: 24,
          borderRadius: '9px',
          border: `1px solid ${panelBorder}`,
          backgroundColor: controlBg,
          display: 'grid',
          placeItems: 'center',
          color: 'text.secondary',
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Stack direction="row" spacing={0.65} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" fontWeight={700} noWrap>
            {title}
          </Typography>
          {status ? (
            <Chip
              label={status}
              size="small"
              sx={{
                height: 20,
                borderRadius: '999px',
                backgroundColor: controlBg,
                border: `1px solid ${panelBorder}`,
                color: 'text.secondary',
                '& .MuiChip-label': {
                  px: 0.65,
                  fontSize: '0.64rem',
                },
              }}
            />
          ) : null}
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          sx={{ flex: 1, minWidth: 0, fontSize: '0.69rem', opacity: 0.72 }}
        >
          {primary}
          {secondary ? ` · ${secondary}` : ''}
        </Typography>
      </Stack>
      <Tooltip title={`展开${title}`}>
        <IconButton
          size="small"
          onClick={onExpand}
          sx={{
            width: 30,
            height: 30,
            flexShrink: 0,
            border: `1px solid ${panelBorder}`,
            backgroundColor: isLight ? 'rgba(31,34,39,0.045)' : 'rgba(255,255,255,0.02)',
            color: 'text.primary',
          }}
        >
          <KeyboardDoubleArrowUpRoundedIcon sx={{ fontSize: 17, transform: 'rotate(180deg)' }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export function WorkbenchPage({
  activeConnection,
  connectionResult,
  workbenchState,
  selectedLocalPath,
  selectedRemotePath,
  selectedLocalPaths,
  selectedRemotePaths,
  transferQueue,
  terminalDirectory,
  terminalLabel,
  terminalHistory,
  terminalSessionId,
  terminalOutput,
  terminalCompletionConfig,
  terminalProfile,
  favorites,
  favoriteConnectionStateById,
  favoriteRemotePoolSummaryById,
  selectedFavoriteId,
  isRemoteBrowserConnected,
  browserPaneErrors,
  isRefreshingLocal,
  isRefreshingRemote,
  isOpeningConnection,
  isSavingFavorite,
  isMutatingFiles,
  isRunningTerminal,
  isStartingTerminal,
  showHidden,
  openingConnectionId,
  onRefreshLocal,
  onRefreshRemote,
  onToggleShowHidden,
  onConnectRemoteBrowser,
  onDisconnectRemoteBrowser,
  onSelectLocalEntry,
  onSelectRemoteEntry,
  onNavigateLocal,
  onNavigateRemote,
  onActivateEntry,
  onCreateDirectory,
  onOpenEntry,
  onPreviewEntry,
  onMd5Entry,
  onRenameEntry,
  onCopyEntry,
  onMoveEntry,
  onChangePermissions,
  onDeleteEntry,
  onQueueUpload,
  onQueueDownload,
  onQueueRemoteCopy,
  onOpenSearchDialog,
  onCancelTransfer,
  onRetryTransfer,
  onClearCompletedTransfers,
  onClearStoppedTransfers,
  onRetryStoppedTransfers,
  onStartTerminalSession,
  onStopTerminalSession,
  onSendTerminalInput,
  onTerminalDebug,
  onClearTerminalHistory,
  onOpenConnectionDialog,
  onSelectFavoriteTab,
  onOpenFavoriteConfig,
  onRenameFavoriteTab,
  onRemoveFavoriteTab,
  onCloseFavoriteTerminal,
  onDisconnectFavoriteConnection,
  onSaveFavoriteDirectory,
  onOpenFavoriteDirectory,
  canUseRemoteTerminal,
  styleMode,
  onToggleStyleMode,
}: WorkbenchPageProps) {
  const [entryActionMenu, setEntryActionMenu] = useState<EntryActionMenuState | null>(null);
  const [isTerminalDialogOpen, setIsTerminalDialogOpen] = useState(false);
  const [browserQueueRatio, setBrowserQueueRatio] = useState(0.72);
  const [paneDirectoryMenuAnchor, setPaneDirectoryMenuAnchor] = useState<HTMLElement | null>(null);
  const workbenchPanelRef = useRef<HTMLDivElement | null>(null);
  const didAutoStartTerminalRef = useRef(false);
  const localListing = workbenchState?.local;
  const remoteListing = workbenchState?.remote;
  const canBrowseLocal = Boolean(localListing);
  const canBrowseRemote = Boolean(activeConnection && remoteListing && isRemoteBrowserConnected);
  const canOpenRemoteTerminal = Boolean(canUseRemoteTerminal && activeConnection);
  const panelGridRows = `minmax(260px, ${browserQueueRatio}fr) 10px minmax(104px, ${1 - browserQueueRatio}fr)`;

  const resolvedLocalListing: ListingData =
    localListing ?? {
      source: 'local',
      endpoint: null,
      directory: '~/Documents',
      totalEntries: 0,
      visibleEntries: 0,
      entries: [],
    };
  const resolvedRemoteListing: ListingData =
    remoteListing ?? {
      source: 'remote',
      endpoint: activeConnection?.host ?? '未连接',
      directory: activeConnection?.path || '/',
      totalEntries: 0,
      visibleEntries: 0,
      entries: [],
    };
  const transferQueueSummary = summarizeTransferQueue(transferQueue);

  const selectedLocalEntry = selectedLocalPath
    ? resolvedLocalListing.entries.find((entry) => entry.path === selectedLocalPath) ?? null
    : null;
  const selectedRemoteEntry = selectedRemotePath
    ? resolvedRemoteListing.entries.find((entry) => entry.path === selectedRemotePath) ?? null
    : null;
  const selectedLocalPathSet = new Set(selectedLocalPaths);
  const selectedRemotePathSet = new Set(selectedRemotePaths);
  const selectedLocalEntries = resolvedLocalListing.entries.filter((entry) => selectedLocalPathSet.has(entry.path));
  const selectedRemoteEntries = resolvedRemoteListing.entries.filter((entry) => selectedRemotePathSet.has(entry.path));
  const selectedLocalCount = selectedLocalPaths.length;
  const selectedRemoteCount = selectedRemotePaths.length;
  const menuEntry = entryActionMenu?.entry ?? null;
  const isMenuDirectory = menuEntry?.kind === 'directory';
  const isMenuArchive = isArchiveEntry(menuEntry);
  const menuSelectionCount = entryActionMenu?.scope === 'local' ? selectedLocalCount : selectedRemoteCount;
  const menuSelectionPaths = entryActionMenu?.scope === 'local' ? selectedLocalPaths : selectedRemotePaths;
  const menuSelectionEntries = entryActionMenu?.scope === 'local' ? selectedLocalEntries : selectedRemoteEntries;
  const menuUsesSelection =
    Boolean(menuEntry && menuSelectionCount > 1 && menuSelectionPaths.includes(menuEntry.path));
  const menuSearchLabel = menuUsesSelection
    ? `在已选 ${menuSelectionCount} 项中搜索`
    : isMenuDirectory
      ? '在此文件夹中搜索'
      : isMenuArchive
        ? '在压缩包中搜索'
        : '在此文件中搜索';
  const activeDirectoryFavorite = activeConnection
    ? (selectedFavoriteId
        ? favorites.find(
            (favorite) =>
              favorite.id === selectedFavoriteId &&
              favoriteMatchesActiveEndpoint(favorite, activeConnection),
          )
        : null) ??
      favorites.find((favorite) => favoriteMatchesActiveEndpoint(favorite, activeConnection)) ??
      null
    : null;
  const paneDirectoryOptions = activeDirectoryFavorite ? favoriteDirectoryPaths(activeDirectoryFavorite) : [];
  const canSavePaneDirectory = Boolean(activeDirectoryFavorite && canBrowseRemote);
  const startBrowserQueueResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = workbenchPanelRef.current;
    if (!container) {
      return;
    }

    const updateRatio = (clientY: number) => {
      const bounds = container.getBoundingClientRect();
      if (bounds.height <= 0) {
        return;
      }

      const nextRatio = (clientY - bounds.top) / bounds.height;
      setBrowserQueueRatio(Math.min(0.86, Math.max(0.5, nextRatio)));
    };

    updateRatio(event.clientY);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateRatio(moveEvent.clientY);
    };
    const handlePointerUp = () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  const openEntryActionMenu = (
    scope: FileMutationScope,
    entry: DirectoryEntry,
    trigger?: EntryActionMenuTrigger,
  ) => {
    const currentSelectedPaths = scope === 'local' ? selectedLocalPaths : selectedRemotePaths;
    if (!currentSelectedPaths.includes(entry.path)) {
      if (scope === 'local') {
        onSelectLocalEntry(entry);
      } else {
        onSelectRemoteEntry(entry);
      }
    }

    setEntryActionMenu({
      scope,
      entry,
      anchorEl: trigger?.anchorEl ?? null,
      anchorPosition: trigger?.anchorPosition ?? null,
    });
  };

  const openPaneOptionsMenu = (scope: FileMutationScope, anchorEl: HTMLElement) => {
    setEntryActionMenu({
      scope,
      entry: null,
      anchorEl,
      anchorPosition: null,
    });
  };

  const closeEntryActionMenu = () => {
    setEntryActionMenu(null);
    setPaneDirectoryMenuAnchor(null);
  };

  const closePaneDirectoryMenu = () => {
    setPaneDirectoryMenuAnchor(null);
  };

  useEffect(() => {
    if (!isTerminalDialogOpen) {
      didAutoStartTerminalRef.current = false;
      return;
    }

    if (
      didAutoStartTerminalRef.current ||
      terminalSessionId ||
      isStartingTerminal ||
      !canOpenRemoteTerminal
    ) {
      return;
    }

    didAutoStartTerminalRef.current = true;
    onStartTerminalSession();
  }, [
    canOpenRemoteTerminal,
    isStartingTerminal,
    isTerminalDialogOpen,
    onStartTerminalSession,
    terminalSessionId,
  ]);

  const runEntryAction = (
    action:
      | 'open'
      | 'preview'
      | 'md5'
      | 'system-open'
      | 'rename'
      | 'copy'
      | 'move'
      | 'chmod'
      | 'delete'
      | 'search'
      | 'transfer'
      | 'remote-copy',
  ) => {
    if (!entryActionMenu) {
      return;
    }

    const { scope, entry } = entryActionMenu;
    if (!entry) {
      return;
    }

    closeEntryActionMenu();

    if (action === 'open') {
      if (entry.kind === 'directory') {
        if (scope === 'local') {
          onNavigateLocal(entry.path);
        } else {
          onNavigateRemote(entry.path);
        }
        return;
      }

      onActivateEntry(scope, entry);
      return;
    }

    if (action === 'preview') {
      onPreviewEntry(scope, entry);
      return;
    }

    if (action === 'md5') {
      onMd5Entry(scope, entry);
      return;
    }

    if (action === 'system-open') {
      onOpenEntry(scope, entry);
      return;
    }

    if (action === 'rename') {
      onRenameEntry(scope, entry);
      return;
    }

    if (action === 'copy') {
      onCopyEntry(scope, menuUsesSelection ? undefined : entry);
      return;
    }

    if (action === 'move') {
      onMoveEntry(scope, menuUsesSelection ? undefined : entry);
      return;
    }

    if (action === 'chmod') {
      onChangePermissions(scope, menuUsesSelection ? undefined : entry);
      return;
    }

    if (action === 'delete') {
      onDeleteEntry(scope, menuUsesSelection ? undefined : entry);
      return;
    }

    if (action === 'search') {
      const directory = scope === 'local' ? resolvedLocalListing.directory : resolvedRemoteListing.directory;
      const targets = menuUsesSelection ? menuSelectionEntries : [entry];
      onOpenSearchDialog(scope, directory, targets);
      return;
    }

    if (action === 'remote-copy') {
      onQueueRemoteCopy(menuUsesSelection ? undefined : entry);
      return;
    }

    if (scope === 'local') {
      onQueueUpload(menuUsesSelection ? undefined : entry);
      return;
    }

    onQueueDownload(menuUsesSelection ? undefined : entry);
  };

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      <Box
        sx={{
          mb: 0.48,
          position: 'relative',
          zIndex: 2,
          px: { xs: 0.42, md: 0.5 },
          py: { xs: 0.32, md: 0.36 },
          borderRadius: '11px',
          border: '1px solid var(--rterm-panel-border)',
          backgroundColor: (theme) =>
            theme.palette.mode === 'light' ? 'rgba(255,255,255,0.78)' : 'rgba(16,24,34,0.72)',
          boxShadow: (theme) =>
            theme.palette.mode === 'light'
              ? '0 12px 28px rgba(46,83,126,0.045), inset 0 1px 0 rgba(255,255,255,0.76)'
              : 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <Stack
          direction="row"
          spacing={0.65}
          alignItems="center"
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={0.65} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
            <RSeriesBadge />
            <FavoriteHostStrip
              favorites={favorites}
              activeConnection={activeConnection}
              favoriteConnectionStateById={favoriteConnectionStateById}
              favoriteRemotePoolSummaryById={favoriteRemotePoolSummaryById}
              selectedFavoriteId={selectedFavoriteId}
              isOpeningConnection={isOpeningConnection}
              openingConnectionId={openingConnectionId}
              onSelectFavoriteTab={onSelectFavoriteTab}
              onOpenFavoriteConfig={onOpenFavoriteConfig}
              onRenameFavoriteTab={onRenameFavoriteTab}
              onRemoveFavoriteTab={onRemoveFavoriteTab}
              onCloseFavoriteTerminal={onCloseFavoriteTerminal}
              onDisconnectFavoriteConnection={onDisconnectFavoriteConnection}
              onOpenFavoriteDirectory={onOpenFavoriteDirectory}
            />
          </Stack>

          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
            <Tooltip title="主机配置">
              <IconButton
                onClick={onOpenConnectionDialog}
                size="small"
                aria-label="主机配置"
                sx={{
                  width: 30,
                  height: 30,
                  border: (theme) => `1px solid ${theme.palette.divider}`,
                  backgroundColor: 'var(--rterm-accent-soft)',
                  color: 'var(--rterm-accent)',
                }}
              >
                <FolderSpecialRoundedIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={styleMode === 'dark' ? '切换亮色风格' : '切换暗色风格'}>
              <IconButton
                onClick={onToggleStyleMode}
                size="small"
                aria-label={styleMode === 'dark' ? '切换亮色风格' : '切换暗色风格'}
                sx={{
                  width: 30,
                  height: 30,
                  border: (theme) => `1px solid ${theme.palette.divider}`,
                  backgroundColor: 'var(--rterm-warning-soft)',
                  color: 'var(--rterm-warning)',
                }}
              >
                {styleMode === 'dark' ? (
                  <LightModeRoundedIcon sx={{ fontSize: 17 }} />
                ) : (
                  <DarkModeRoundedIcon sx={{ fontSize: 17 }} />
                )}
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </Box>

      <Box
        sx={{
          flex: '1 1 auto',
          display: 'grid',
          gap: 0.88,
          alignItems: 'stretch',
          minHeight: 0,
          position: 'relative',
          gridTemplateColumns: 'minmax(0, 1fr)',
        }}
      >
        <Box sx={{ display: 'flex', minWidth: 0, minHeight: 0, position: 'relative', zIndex: 1 }}>
          <Box
            ref={workbenchPanelRef}
            sx={{
              flex: 1,
              minWidth: 0,
              display: 'grid',
              gridTemplateRows: panelGridRows,
              rowGap: 0,
              alignContent: 'stretch',
              minHeight: 0,
              height: '100%',
            }}
          >
            <Box sx={{ minHeight: 0, minWidth: 0, display: 'flex', position: 'relative', zIndex: 1 }}>
              <SectionCard
                title="连接"
                compact
                actions={
                  <Stack
                    direction="row"
                    spacing={0.55}
                    useFlexGap
                    flexWrap="wrap"
                    justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}
                    sx={{ width: { xs: '100%', sm: 'auto' } }}
                  >
                    <Tooltip
                      title={
                        isRefreshingRemote
                          ? '正在连接远端文件区'
                          : canBrowseRemote
                            ? '断开远端文件区'
                            : '连接远端文件区'
                      }
                    >
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => (canBrowseRemote ? onDisconnectRemoteBrowser() : onConnectRemoteBrowser())}
                          disabled={!activeConnection || isRefreshingRemote}
                          sx={{
                            width: 34,
                            height: 34,
                            border: '1px solid var(--rterm-remote-border)',
                            backgroundColor: 'var(--rterm-remote-soft)',
                            color: 'var(--rterm-remote)',
                            '&.Mui-disabled': {
                              color: (theme) =>
                                theme.palette.mode === 'light'
                                  ? 'rgba(31,34,39,0.34)'
                                  : 'rgba(255,255,255,0.28)',
                              backgroundColor: (theme) =>
                                theme.palette.mode === 'light'
                                  ? 'rgba(31,34,39,0.035)'
                                  : 'rgba(255,255,255,0.012)',
                            },
                          }}
                        >
                          {isRefreshingRemote ? (
                            <CircularProgress
                              size={15}
                              thickness={4.5}
                              sx={{
                                color: (theme) =>
                                  theme.palette.mode === 'light'
                                    ? 'rgba(31,34,39,0.72)'
                                    : 'rgba(255,255,255,0.72)',
                              }}
                            />
                          ) : canBrowseRemote ? (
                            <LinkOffRoundedIcon sx={{ fontSize: 18 }} />
                          ) : (
                            <LinkRoundedIcon sx={{ fontSize: 18 }} />
                          )}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip
                      title={
                        canOpenRemoteTerminal
                          ? terminalSessionId
                            ? '打开远端终端'
                            : '打开并连接远端终端'
                          : '请选择支持远端终端的 SFTP/SCP 主机'
                      }
                    >
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => setIsTerminalDialogOpen(true)}
                          disabled={!canOpenRemoteTerminal || isStartingTerminal}
                          aria-label={
                            canOpenRemoteTerminal
                              ? terminalSessionId
                                ? '打开远端终端'
                                : '打开并连接远端终端'
                              : '请选择支持远端终端的 SFTP/SCP 主机'
                          }
                          sx={{
                            width: 34,
                            height: 34,
                            border: '1px solid var(--rterm-accent-border)',
                            backgroundColor: 'var(--rterm-accent-soft)',
                            color: 'var(--rterm-accent)',
                            '&.Mui-disabled': {
                              color: (theme) =>
                                theme.palette.mode === 'light'
                                  ? 'rgba(31,34,39,0.34)'
                                  : 'rgba(255,255,255,0.28)',
                              backgroundColor: (theme) =>
                                theme.palette.mode === 'light'
                                  ? 'rgba(31,34,39,0.035)'
                                  : 'rgba(255,255,255,0.012)',
                            },
                          }}
                        >
                          <TerminalRoundedIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                }
              >
                <Stack spacing={0.72} sx={{ height: '100%', minHeight: 0 }}>
                  <Box
                    sx={{
                      flex: 1,
                      minHeight: 0,
                      display: 'grid',
                      gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
                      gap: { xs: 0.78, md: 0.82 },
                      overflow: { xs: 'auto', md: 'hidden' },
                      px: { xs: 0, md: 0.02 },
                    }}
                  >
                    <Box sx={{ display: 'flex', minHeight: { xs: 320, md: 0 }, minWidth: 0, overflow: 'hidden' }}>
                      <BrowserPane
                        title="本地"
                        directory={resolvedLocalListing.directory}
                        entries={resolvedLocalListing.entries}
                        icon={<ComputerRoundedIcon sx={{ fontSize: 16 }} />}
                        operation={
                          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                            <PaneOperationButton
                              label="刷新本地目录"
                              icon={
                                isRefreshingLocal ? (
                                  <CircularProgress
                                    size={15}
                                    thickness={4.5}
                                    sx={{
                                      color: (theme) =>
                                        theme.palette.mode === 'light'
                                          ? 'rgba(31,34,39,0.72)'
                                          : 'rgba(255,255,255,0.72)',
                                    }}
                                  />
                                ) : (
                                  <RefreshRoundedIcon sx={{ fontSize: 17 }} />
                                )
                              }
                              disabled={!canBrowseLocal || isRefreshingLocal}
                              onClick={onRefreshLocal}
                            />
                            <PaneOperationButton
                              label="新建本地目录"
                              icon={<CreateNewFolderRoundedIcon sx={{ fontSize: 17 }} />}
                              disabled={!canBrowseLocal || isRefreshingLocal || isMutatingFiles}
                              onClick={() => onCreateDirectory('local')}
                            />
                            <PaneOperationButton
                              label={
                                selectedLocalCount === 1 && selectedLocalEntry
                                  ? `更多操作：${selectedLocalEntry.name}`
                                  : selectedLocalCount > 1
                                    ? `更多操作：已选 ${selectedLocalCount} 项`
                                    : '更多本地选项'
                              }
                              icon={<MoreHorizRoundedIcon sx={{ fontSize: 17 }} />}
                              disabled={!canBrowseLocal || isRefreshingLocal}
                              onClick={(event) => {
                                const entry =
                                  selectedLocalEntry ??
                                  resolvedLocalListing.entries.find((currentEntry) =>
                                    selectedLocalPaths.includes(currentEntry.path),
                                  );
                                if (entry) {
                                  openEntryActionMenu('local', entry, {
                                    anchorEl: event.currentTarget,
                                  });
                                  return;
                                }

                                openPaneOptionsMenu('local', event.currentTarget);
                              }}
                            />
                          </Stack>
                        }
                        selectedPath={selectedLocalPath}
                        selectedPaths={selectedLocalPaths}
                        isBusy={isRefreshingLocal}
                        isInteractive={canBrowseLocal}
                        emptyStateVariant={canBrowseLocal ? 'empty' : 'loading'}
                        error={browserPaneErrors.local}
                        onSelectEntry={onSelectLocalEntry}
                        onActivateEntry={(entry) => onActivateEntry('local', entry)}
                        onContextMenu={(entry, anchorPosition) =>
                          openEntryActionMenu('local', entry, {
                            anchorPosition,
                          })
                        }
                        onNavigate={onNavigateLocal}
                      />
                    </Box>
                    <Box sx={{ display: 'flex', minHeight: { xs: 320, md: 0 }, minWidth: 0, overflow: 'hidden' }}>
                      <BrowserPane
                        title="远端"
                        directory={resolvedRemoteListing.directory}
                        entries={resolvedRemoteListing.entries}
                        icon={<CloudQueueRoundedIcon sx={{ fontSize: 16 }} />}
                        operation={
                          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                            <PaneOperationButton
                              label="刷新远端目录"
                              icon={
                                isRefreshingRemote ? (
                                  <CircularProgress
                                    size={15}
                                    thickness={4.5}
                                    sx={{
                                      color: (theme) =>
                                        theme.palette.mode === 'light'
                                          ? 'rgba(31,34,39,0.72)'
                                          : 'rgba(255,255,255,0.72)',
                                    }}
                                  />
                                ) : (
                                  <RefreshRoundedIcon sx={{ fontSize: 17 }} />
                                )
                              }
                              disabled={!canBrowseRemote || isRefreshingRemote}
                              onClick={onRefreshRemote}
                            />
                            <PaneOperationButton
                              label="保存当前远端目录"
                              icon={<FolderSpecialRoundedIcon sx={{ fontSize: 17 }} />}
                              disabled={!canSavePaneDirectory || isRefreshingRemote}
                              onClick={() => {
                                if (activeDirectoryFavorite) {
                                  onSaveFavoriteDirectory(activeDirectoryFavorite);
                                }
                              }}
                            />
                            <PaneOperationButton
                              label="进入已保存远端目录"
                              icon={<FolderOpenRoundedIcon sx={{ fontSize: 17 }} />}
                              disabled={!activeDirectoryFavorite || paneDirectoryOptions.length === 0 || isOpeningConnection}
                              onClick={(event) => {
                                setPaneDirectoryMenuAnchor(event.currentTarget);
                              }}
                            />
                            <PaneOperationButton
                              label="新建远端目录"
                              icon={<CreateNewFolderRoundedIcon sx={{ fontSize: 17 }} />}
                              disabled={!canBrowseRemote || isRefreshingRemote || isMutatingFiles}
                              onClick={() => onCreateDirectory('remote')}
                            />
                            <PaneOperationButton
                              label={
                                selectedRemoteCount === 1 && selectedRemoteEntry
                                  ? `更多操作：${selectedRemoteEntry.name}`
                                  : selectedRemoteCount > 1
                                    ? `更多操作：已选 ${selectedRemoteCount} 项`
                                    : '更多远端选项'
                              }
                              icon={<MoreHorizRoundedIcon sx={{ fontSize: 17 }} />}
                              disabled={!activeConnection || isRefreshingRemote}
                              onClick={(event) => {
                                const entry =
                                  selectedRemoteEntry ??
                                  resolvedRemoteListing.entries.find((currentEntry) =>
                                    selectedRemotePaths.includes(currentEntry.path),
                                  );
                                if (entry) {
                                  openEntryActionMenu('remote', entry, {
                                    anchorEl: event.currentTarget,
                                  });
                                  return;
                                }

                                openPaneOptionsMenu('remote', event.currentTarget);
                              }}
                            />
                          </Stack>
                        }
                        selectedPath={selectedRemotePath}
                        selectedPaths={selectedRemotePaths}
                        isBusy={isRefreshingRemote}
                        isInteractive={canBrowseRemote}
                        emptyStateVariant={canBrowseRemote ? 'empty' : 'remote'}
                        error={browserPaneErrors.remote}
                        onSelectEntry={onSelectRemoteEntry}
                        onActivateEntry={(entry) => onActivateEntry('remote', entry)}
                        onContextMenu={(entry, anchorPosition) =>
                          openEntryActionMenu('remote', entry, {
                            anchorPosition,
                          })
                        }
                        onNavigate={onNavigateRemote}
                      />
                    </Box>
                  </Box>
                </Stack>
              </SectionCard>
            </Box>
            <Box
              role="separator"
              aria-label="调整连接区和传输队列高度"
              onPointerDown={startBrowserQueueResize}
              sx={{
                height: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'row-resize',
                touchAction: 'none',
                position: 'relative',
                zIndex: 3,
                '&::before': {
                  content: '""',
                  width: 82,
                  height: 2,
                  borderRadius: 999,
                  backgroundColor: (theme) =>
                    theme.palette.mode === 'light' ? 'rgba(31,34,39,0.2)' : 'rgba(255,255,255,0.12)',
                  boxShadow: (theme) =>
                    theme.palette.mode === 'light'
                      ? '0 0 0 1px rgba(255,255,255,0.65)'
                      : '0 0 0 1px rgba(0,0,0,0.18)',
                  transition: 'background-color 120ms ease, width 120ms ease',
                },
                '&:hover::before': {
                  width: 112,
                  backgroundColor: (theme) =>
                    theme.palette.mode === 'light' ? 'rgba(31,34,39,0.34)' : 'rgba(245,243,238,0.34)',
                },
              }}
            />
            <Box sx={{ minHeight: 0, minWidth: 0, display: 'flex' }}>
              <TransferQueueDock
                compact
                items={transferQueue}
                summary={transferQueueSummary}
                onCancel={onCancelTransfer}
                onRetry={onRetryTransfer}
                onClearCompleted={onClearCompletedTransfers}
                onClearStopped={onClearStoppedTransfers}
                onRetryStopped={onRetryStoppedTransfers}
              />
            </Box>
          </Box>
        </Box>
      </Box>
      <Dialog
        open={isTerminalDialogOpen}
        onClose={() => setIsTerminalDialogOpen(false)}
        maxWidth="md"
        fullWidth
        slotProps={{
          backdrop: {
            sx: {
              backgroundColor: (theme) =>
                theme.palette.mode === 'light' ? 'rgba(31,34,39,0.3)' : 'rgba(0,0,0,0.58)',
              backdropFilter: 'blur(2px)',
            },
          },
        }}
        PaperProps={{
          sx: {
            position: 'relative',
            isolation: 'isolate',
            width: { xs: 'calc(100vw - 24px)', md: 920 },
            maxWidth: 'calc(100vw - 32px)',
            height: { xs: 'min(78vh, 600px)', md: 'min(72vh, 620px)' },
            borderRadius: '16px',
            border: '1px solid var(--rterm-panel-border)',
            backgroundColor: (theme) =>
              theme.palette.mode === 'light' ? 'rgba(251,253,255,0.988)' : 'rgba(14,21,31,0.985)',
            boxShadow: (theme) =>
              theme.palette.mode === 'light'
                ? '0 22px 64px rgba(31,34,39,0.18), 0 1px 0 rgba(255,255,255,0.78) inset'
                : '0 26px 82px rgba(0,0,0,0.58), 0 1px 0 rgba(255,255,255,0.045) inset',
            overflow: 'hidden',
          },
        }}
      >
        <Box sx={{ height: '100%', minHeight: 0 }}>
          <TerminalPanel
            directory={terminalDirectory || resolvedRemoteListing.directory}
            label={terminalLabel}
            canUseRemote={canUseRemoteTerminal}
            history={terminalHistory}
            entries={resolvedRemoteListing.entries}
            favorites={favorites}
            completionConfig={terminalCompletionConfig ?? defaultTerminalCompletionConfig}
            targetProfile={terminalProfile}
            sessionId={terminalSessionId}
            output={terminalOutput}
            isRunning={isRunningTerminal}
            isStarting={isStartingTerminal}
            onStartSession={onStartTerminalSession}
            onStopSession={onStopTerminalSession}
            onSendInput={onSendTerminalInput}
            onTerminalDebug={onTerminalDebug}
            onClearHistory={onClearTerminalHistory}
            onCloseDialog={() => setIsTerminalDialogOpen(false)}
          />
        </Box>
      </Dialog>
      <Menu
        open={Boolean(entryActionMenu)}
        onClose={closeEntryActionMenu}
        anchorReference={entryActionMenu?.anchorPosition ? 'anchorPosition' : 'anchorEl'}
        anchorEl={entryActionMenu?.anchorPosition ? undefined : entryActionMenu?.anchorEl}
        anchorPosition={entryActionMenu?.anchorPosition ?? undefined}
        PaperProps={{
          sx: {
            minWidth: 188,
            borderRadius: '14px',
            border: (theme) => `1px solid ${theme.palette.divider}`,
            backgroundColor: (theme) =>
              theme.palette.mode === 'light' ? '#fffdf8' : 'rgba(22,24,29,0.98)',
            backdropFilter: (theme) => (theme.palette.mode === 'light' ? 'none' : 'blur(18px)'),
            boxShadow: (theme) =>
              theme.palette.mode === 'light'
                ? '0 16px 34px rgba(31,34,39,0.14)'
                : '0 16px 40px rgba(0,0,0,0.34)',
            '& .MuiMenuItem-root': {
              minHeight: 34,
              px: 1.1,
              py: 0.55,
              gap: 0.8,
              borderRadius: '10px',
              mx: 0.45,
              my: 0.12,
              color: 'text.primary',
            },
          },
        }}
	      >
	        {entryActionMenu ? (
	          <Box sx={{ py: 0.35 }}>
	            <MenuItem
	              disabled={isRefreshingLocal || isRefreshingRemote}
	              onClick={() => {
	                closeEntryActionMenu();
	                onToggleShowHidden();
	              }}
		            >
		              {showHidden ? (
		                <VisibilityOffRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
		              ) : (
		                <VisibilityRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
		              )}
		              <Typography variant="body2">显示隐藏文件</Typography>
		            </MenuItem>
		            <MenuItem
			              disabled={
			                entryActionMenu.scope === 'local'
			                  ? !canBrowseLocal || isRefreshingLocal
			                  : !canBrowseRemote || isRefreshingRemote
		              }
		              onClick={() => {
		                const scope = entryActionMenu.scope;
		                closeEntryActionMenu();
		                onOpenSearchDialog(scope);
			              }}
		            >
		              <SearchRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
			              <Typography variant="body2">
			                {entryActionMenu.scope === 'local' ? '搜索当前本地目录' : '搜索当前远端目录'}
			              </Typography>
			            </MenuItem>
			            {entryActionMenu.scope === 'remote' && !menuEntry ? (
			              <MenuItem
			                disabled={!canSavePaneDirectory || isRefreshingRemote}
			                onClick={() => {
			                  if (activeDirectoryFavorite) {
			                    onSaveFavoriteDirectory(activeDirectoryFavorite);
			                  }
			                  closeEntryActionMenu();
			                }}
			              >
			                <FolderSpecialRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
			                <Typography variant="body2">保存目录</Typography>
			              </MenuItem>
			            ) : null}
			            {entryActionMenu.scope === 'remote' && !menuEntry ? (
			              <MenuItem
			                disabled={!activeDirectoryFavorite || paneDirectoryOptions.length === 0 || isOpeningConnection}
			                onClick={(event) => {
			                  setPaneDirectoryMenuAnchor(event.currentTarget);
			                }}
			                sx={{ justifyContent: 'space-between', gap: 1.5 }}
			              >
			                <Stack direction="row" spacing={0.8} alignItems="center" sx={{ minWidth: 0 }}>
			                  <FolderOpenRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
			                  <Typography variant="body2">进入目录</Typography>
			                </Stack>
			                <ChevronRightRoundedIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
			              </MenuItem>
			            ) : null}
			            {menuEntry ? <Divider sx={{ my: 0.32, borderColor: (theme) => theme.palette.divider }} /> : null}
	            {menuEntry && !menuUsesSelection ? (
	              <MenuItem onClick={() => runEntryAction('open')}>
	                {isMenuDirectory ? (
	                  <FolderRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
	                ) : (
	                  <ArticleRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
	                )}
	                <Typography variant="body2">{isMenuDirectory ? '打开目录' : '打开'}</Typography>
	              </MenuItem>
	            ) : null}
	            {menuEntry ? (
	              <MenuItem onClick={() => runEntryAction('search')}>
	                <SearchRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
	                <Typography variant="body2">{menuSearchLabel}</Typography>
	              </MenuItem>
	            ) : null}
	            {menuEntry && !menuUsesSelection && !isMenuDirectory ? (
	              <MenuItem onClick={() => runEntryAction('preview')}>
	                <ArticleRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
	                <Typography variant="body2">快速预览</Typography>
	              </MenuItem>
	            ) : null}
	            {menuEntry && !menuUsesSelection && !isMenuDirectory ? (
	              <MenuItem onClick={() => runEntryAction('md5')}>
	                <FingerprintRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
	                <Typography variant="body2">计算 MD5</Typography>
	              </MenuItem>
	            ) : null}
	            {menuEntry && !menuUsesSelection && !isMenuDirectory ? (
	              <MenuItem onClick={() => runEntryAction('system-open')}>
	                <OpenInNewRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
	                <Typography variant="body2">系统打开</Typography>
	              </MenuItem>
	            ) : null}
	            {menuEntry ? <Divider sx={{ my: 0.32, borderColor: (theme) => theme.palette.divider }} /> : null}
	            {menuEntry ? (
	              <MenuItem onClick={() => runEntryAction('transfer')}>
	                {entryActionMenu?.scope === 'local' ? (
	                  <UploadRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
	                ) : (
	                  <DownloadRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
	                )}
	                <Typography variant="body2">
	                  {entryActionMenu?.scope === 'local'
	                    ? menuUsesSelection
	                      ? `上传到当前远端目录 (${menuSelectionCount} 项)`
	                      : '上传到当前远端目录'
	                    : menuUsesSelection
	                      ? `下载到当前本地目录 (${menuSelectionCount} 项)`
	                      : '下载到当前本地目录'}
	                </Typography>
	              </MenuItem>
	            ) : null}
	            {menuEntry && entryActionMenu?.scope === 'remote' ? (
	              <MenuItem onClick={() => runEntryAction('remote-copy')}>
	                <ContentCopyRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
	                <Typography variant="body2">
	                  {menuUsesSelection ? `复制已选 ${menuSelectionCount} 项到其他远端...` : '复制到其他远端...'}
	                </Typography>
	              </MenuItem>
	            ) : null}
	            {menuEntry && !menuUsesSelection ? (
	              <MenuItem onClick={() => runEntryAction('rename')}>
	                <DriveFileRenameOutlineRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
	                <Typography variant="body2">重命名</Typography>
	              </MenuItem>
	            ) : null}
	            {menuEntry ? (
	              <MenuItem onClick={() => runEntryAction('copy')}>
	                <ContentCopyRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
	                <Typography variant="body2">{menuUsesSelection ? `复制已选 ${menuSelectionCount} 项到...` : '复制到...'}</Typography>
	              </MenuItem>
	            ) : null}
	            {menuEntry ? (
	              <MenuItem onClick={() => runEntryAction('move')}>
	                <DriveFileMoveRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
	                <Typography variant="body2">{menuUsesSelection ? `移动已选 ${menuSelectionCount} 项到...` : '移动到...'}</Typography>
	              </MenuItem>
	            ) : null}
	            {menuEntry ? (
	              <MenuItem onClick={() => runEntryAction('chmod')}>
	                <KeyRoundedIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
	                <Typography variant="body2">{menuUsesSelection ? `修改已选 ${menuSelectionCount} 项权限...` : '权限...'}</Typography>
	              </MenuItem>
	            ) : null}
	            {menuEntry ? (
	              <MenuItem
	                onClick={() => runEntryAction('delete')}
	                sx={{
	                  color: 'text.primary',
	                  '& .MuiTypography-root, & svg': {
	                    color: 'text.primary',
	                  },
	                }}
	              >
	                <DeleteOutlineRoundedIcon sx={{ fontSize: 17 }} />
	                <Typography variant="body2">{menuUsesSelection ? `删除已选 ${menuSelectionCount} 项` : '删除'}</Typography>
	              </MenuItem>
	            ) : null}
	          </Box>
	        ) : null}
	      </Menu>
	      <Menu
        open={Boolean(paneDirectoryMenuAnchor)}
	        anchorEl={paneDirectoryMenuAnchor}
	        onClose={closePaneDirectoryMenu}
	        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
	        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
	        PaperProps={{
	          sx: {
	            minWidth: 232,
	            maxWidth: 360,
	            borderRadius: '14px',
	            border: (theme) => `1px solid ${theme.palette.divider}`,
	            backgroundColor: (theme) =>
	              theme.palette.mode === 'light' ? '#fffdf8' : 'rgba(22,24,29,0.98)',
	            boxShadow: (theme) =>
	              theme.palette.mode === 'light'
	                ? '0 16px 34px rgba(31,34,39,0.14)'
	                : '0 16px 40px rgba(0,0,0,0.34)',
	          },
	        }}
	      >
	        {activeDirectoryFavorite
	          ? paneDirectoryOptions.map((path) => (
	              <MenuItem
	                key={path}
	                disabled={isOpeningConnection}
	                title={path}
	                onClick={() => {
	                  onOpenFavoriteDirectory(activeDirectoryFavorite, path);
	                  closeEntryActionMenu();
	                }}
	              >
	                <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>
	                  {path}
	                </Typography>
	              </MenuItem>
	            ))
	          : null}
	      </Menu>
	    </Box>
	  );
	}
