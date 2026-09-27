import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
import {
  Box,
  Button,
  CircularProgress,
  CssBaseline,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  ThemeProvider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { startTransition, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { AppShell } from '@/components/AppShell';
import { useLocalStorageState } from '@/hooks/use-local-storage-state';
import {
  createTransferQueueItem,
  isTransferCancelled,
  transferCompletionDetail,
  upsertTransferQueueItem,
  useTransferQueue,
} from '@/hooks/use-transfer-queue';
import {
  searchDialogSubtitle,
  searchDialogTitle,
  searchMatchDisplayName,
  searchMatchDisplayPath,
  useWorkbenchSearch,
} from '@/hooks/use-workbench-search';
import {
  buildRemoteSpec,
  browseLocalDirectory,
  browseRemoteDirectory,
  cancelTransfer,
  calculateMd5,
  chmodEntry,
  closeTerminalSession,
  copyEntry,
  createDirectory,
  deleteEntry,
  executeTransfer,
  inspectTransferConflicts,
  loadFilePreview,
  loadFavoritePassword,
  loadFavorites,
  listRemoteSessionStates,
  loadTerminalCompletionConfig,
  loadRecentConnections,
  loadWorkbench,
  openEntry,
  renameEntry,
  removeFavorite,
  removeRecentConnection,
  renameFavorite,
  rememberRecentConnection,
  saveFavorite,
  saveTextFile,
  moveEntry,
  startRemoteTerminalSession,
  supportsRemoteTerminal,
  subscribeTerminalDebug,
  subscribeTerminalExit,
  subscribeTerminalOutput,
  testConnection,
  writeTerminalInput,
} from '@/lib/rterm-runtime';
import {
  defaultTerminalCompletionConfig,
  type TerminalCompletionConfigFile,
} from '@/lib/terminal-completion';
import type {
  BrowseEntry,
  BrowseListData,
  ConnectionDraft,
  ConnectionTestResult,
  FavoriteItem,
  FileDigestResult,
  FilePreviewResult,
  FileMutationScope,
  ProtocolOption,
  RecentConnectionRecord,
  RemoteSessionState,
  RuntimeMode,
  SearchMode,
  SessionItem,
  TerminalDebugEvent,
  TerminalExitEvent,
  TerminalHistoryEntry,
  TerminalProfile,
  TerminalOutputEvent,
  TerminalScope,
  TransferConflictItem,
  TransferConflictPolicy,
  TransferDirection,
  TransferQueueItem,
  TransferRetryPayload,
  WorkbenchState,
} from '@/lib/rterm-types';
import { SessionsPage } from '@/pages/SessionsPage';
import { WorkbenchPage, type BrowserPaneErrors } from '@/pages/WorkbenchPage';
import { createRTermTheme, type RTermStyleMode } from '@/theme/rterm-theme';

type NoticeTone = 'success' | 'error' | 'info';

type UiNotice = {
  tone: NoticeTone;
  title: string;
  detail?: string;
};

type WorkbenchSnapshot = {
  connection: ConnectionDraft;
  workbenchState: WorkbenchState;
  connectionResult: ConnectionTestResult | null;
  localTerminalDirectory: string;
  remoteTerminalDirectory: string;
  remoteBrowserConnected: boolean;
  terminalScope: TerminalScope;
  terminalSessionId: string | null;
  terminalSessionScope: TerminalScope | null;
  terminalHistory: TerminalHistoryEntry[];
  remoteTerminalHistory: TerminalHistoryEntry[];
  terminalOutput: string;
  terminalDebugEntries: string[];
};

type FavoriteTerminalSessionState = {
  sessionId: string;
  scope: TerminalScope;
};

type TransferRequest = {
  connection: ConnectionDraft;
  targetConnection?: ConnectionDraft;
  direction: TransferDirection;
  item: TransferQueueItem;
  sourceName: string;
  localDirectory: string;
  remoteDirectory: string;
  targetRemoteDirectory?: string;
};

type BrowseRuntimeResult = {
  data: BrowseListData;
  runtimeMode: RuntimeMode;
};

type BrowseCacheEntry = BrowseRuntimeResult & {
  cachedAt: number;
};

type PendingTransferConflict = {
  request: TransferRequest;
  conflicts: TransferConflictItem[];
  remainingRequests: TransferRequest[];
};

type PendingRemoteCopy = {
  sourceConnection: ConnectionDraft;
  sourceDirectory: string;
  localDirectory: string;
  entries: BrowseEntry[];
};
type PendingFilePreview = {
  scope: FileMutationScope;
  path: string;
  name: string;
  result: FilePreviewResult | null;
  runtimeMode: RuntimeMode | null;
};

type PendingFileDigest = {
  scope: FileMutationScope;
  name: string;
  path: string;
  result: FileDigestResult;
  runtimeMode: RuntimeMode;
};

type FileMutationAction = 'create-directory' | 'rename' | 'copy' | 'move' | 'chmod' | 'delete';

type PendingFileMutation = {
  action: FileMutationAction;
  scope: FileMutationScope;
  directory: string;
  path?: string;
  paths?: string[];
  entryKind?: BrowseEntry['kind'];
  name: string;
};

const BROWSE_CACHE_TTL_MS = 45_000;
const DEV_CONNECTION_CREDENTIALS_STORAGE_KEY = 'rterm.devConnectionCredentials.v1';
const DEV_SERVER_PORT = '1430';
const plainInputBehaviorProps = {
  autoCapitalize: 'none',
  autoComplete: 'off',
  autoCorrect: 'off',
  spellCheck: false,
} as const;
const filterRemoteCopyDirectoryOptions = createFilterOptions<string>();

const emptyDraft: ConnectionDraft = {
  name: '',
  protocol: 'SFTP',
  host: '',
  port: '22',
  path: '',
  paths: [],
  username: '',
  password: '',
  terminalProfile: 'auto',
  legacySshHostKeyAlgorithms: false,
};

const favoriteImportProtocols: ProtocolOption[] = ['SFTP', 'SCP', 'FTP', 'FTPS', 'WebDAV'];

type FavoriteExportRecord = Omit<FavoriteItem, 'id' | 'password'>;

type FavoriteExportPayload = {
  app: 'rTerm';
  version: 1;
  exportedAt: string;
  passwords: 'omitted';
  favorites: FavoriteExportRecord[];
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') {
      return value.trim();
    }
  }

  return '';
}

function stringArrayField(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) {
      continue;
    }

    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function booleanField(record: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }

  return false;
}

function terminalProfileField(record: Record<string, unknown>, keys: string[]): TerminalProfile {
  const allowed: TerminalProfile[] = ['auto', 'posix', 'bash', 'zsh', 'fish', 'powershell', 'cmd'];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && allowed.includes(value as TerminalProfile)) {
      return value as TerminalProfile;
    }
  }

  return 'auto';
}

function normalizeImportedPort(value: unknown): string {
  if (value == null || value === '') {
    return '';
  }

  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^\d+$/.test(text)) {
    throw new Error('端口必须是数字。');
  }

  const port = Number(text);
  if (port <= 0 || port > 65535) {
    throw new Error('端口必须在 1-65535 之间。');
  }

  return text;
}

function normalizeImportedFavorite(value: unknown, index: number): ConnectionDraft {
  if (!isPlainRecord(value)) {
    throw new Error(`第 ${index + 1} 条配置格式不正确。`);
  }

  const protocol = stringField(value, ['protocol']).toUpperCase() as ProtocolOption;
  if (!favoriteImportProtocols.includes(protocol)) {
    throw new Error(`第 ${index + 1} 条配置的协议不支持。`);
  }

  const host = stringField(value, ['host', 'hostname', 'address']);
  if (!host) {
    throw new Error(`第 ${index + 1} 条配置缺少主机地址。`);
  }

  const path = stringField(value, ['path', 'remotePath', 'remote_path']) || '/';
  const paths = normalizeConnectionPaths([
    path,
    ...stringArrayField(value, ['paths', 'directories', 'directoryList', 'directory_list']),
  ]);
  const name = stringField(value, ['name', 'title']) || `常用 · ${host}`;
  const username = stringField(value, ['username', 'user']);
  const password = stringField(value, ['password']);

  return {
    name,
    protocol,
    host,
    port: normalizeImportedPort(value.port),
    path,
    paths,
    username,
    password,
    terminalProfile: terminalProfileField(value, ['terminalProfile', 'terminal_profile', 'shellProfile', 'shell_profile']),
    legacySshHostKeyAlgorithms: booleanField(value, [
      'legacySshHostKeyAlgorithms',
      'legacy_ssh_host_key_algorithms',
    ]),
  };
}

function parseFavoriteImportPayload(content: string): ConnectionDraft[] {
  const parsed = JSON.parse(content) as unknown;
  const records = Array.isArray(parsed)
    ? parsed
    : isPlainRecord(parsed) && Array.isArray(parsed.favorites)
      ? parsed.favorites
      : isPlainRecord(parsed) && Array.isArray(parsed.hosts)
        ? parsed.hosts
        : null;

  if (!records) {
    throw new Error('没有找到可导入的主机配置。');
  }

  return records.map((record, index) => normalizeImportedFavorite(record, index));
}

function buildFavoriteExportPayload(records: FavoriteItem[]): FavoriteExportPayload {
  return {
    app: 'rTerm',
    version: 1,
    exportedAt: new Date().toISOString(),
    passwords: 'omitted',
    favorites: records.map(({ id: _id, password: _password, ...record }) => record),
  };
}

function formatLastSeen(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));

  if (minutes < 1) {
    return '刚刚';
  }

  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }

  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function toSessionView(record: RecentConnectionRecord): SessionItem {
  return {
    id: record.id,
    host: record.host,
    port: record.port ?? null,
    path: record.path,
    protocol: record.protocol,
    status: 'online',
    lastSeen: formatLastSeen(record.lastConnectedAt),
  };
}

function toDraft(item: Pick<SessionItem, 'protocol' | 'host' | 'port' | 'path'>): ConnectionDraft {
  return {
    name: '',
    protocol: item.protocol,
    host: item.host,
    port: item.port == null ? '' : String(item.port),
    path: item.path,
    paths: [normalizeConnectionPath(item.path)],
    terminalProfile: 'auto',
  };
}

function toDraftFromFavorite(item: FavoriteItem): ConnectionDraft {
  return {
    name: item.name,
    protocol: item.protocol,
    host: item.host,
    port: item.port == null ? '' : String(item.port),
    path: item.path,
    paths: connectionDirectoryPaths(item),
    username: item.username ?? '',
    password: item.password ?? '',
    terminalProfile: item.terminalProfile ?? 'auto',
    legacySshHostKeyAlgorithms: item.legacySshHostKeyAlgorithms ?? false,
  };
}

function normalizedConnectionHost(host: string): string {
  return host.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').toLowerCase();
}

function isIpv4Host(host: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(normalizedConnectionHost(host));
}

function connectionEndpointKey(connection: Pick<ConnectionDraft, 'protocol' | 'host' | 'port'>): string {
  return [
    connection.protocol,
    normalizedConnectionHost(connection.host),
    String(connection.port ?? '').trim(),
  ].join('|');
}

function isDevCredentialPersistenceEnabled(): boolean {
  try {
    if (typeof window === 'undefined') {
      return false;
    }

    return (
      (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') &&
      window.location.port === DEV_SERVER_PORT
    );
  } catch {
    return false;
  }
}

function devCredentialStorage(): Storage | null {
  if (!isDevCredentialPersistenceEnabled()) {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readDevConnectionCredentials(): Record<string, Pick<ConnectionDraft, 'username' | 'password'>> {
  const storage = devCredentialStorage();
  if (!storage) {
    return {};
  }

  try {
    const raw = storage.getItem(DEV_CONNECTION_CREDENTIALS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainRecord(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        if (!isPlainRecord(value)) {
          return [];
        }

        const username = typeof value.username === 'string' ? value.username : '';
        const password = typeof value.password === 'string' ? value.password : '';
        if (!username.trim() && !password) {
          return [];
        }

        return [[key, { username, password }]];
      }),
    );
  } catch {
    return {};
  }
}

function writeDevConnectionCredentials(
  records: Record<string, Pick<ConnectionDraft, 'username' | 'password'>>,
) {
  const storage = devCredentialStorage();
  if (!storage) {
    return;
  }

  const persistable = Object.fromEntries(
    Object.entries(records).filter(([, credentials]) => {
      const username = credentials.username?.trim() ?? '';
      const password = credentials.password ?? '';
      return Boolean(username || password);
    }),
  );

  try {
    if (Object.keys(persistable).length === 0) {
      storage.removeItem(DEV_CONNECTION_CREDENTIALS_STORAGE_KEY);
      return;
    }

    storage.setItem(DEV_CONNECTION_CREDENTIALS_STORAGE_KEY, JSON.stringify(persistable));
  } catch {
    // Dev credential persistence is a convenience cache; failures should not block connecting.
  }
}

function browseCacheKey(
  connection: ConnectionDraft,
  scope: FileMutationScope,
  path: string,
  showHidden: boolean,
): string {
  return [
    scope,
    connectionEndpointKey(connection),
    connection.username?.trim() ?? '',
    connection.legacySshHostKeyAlgorithms ? 'legacy-ssh-host-key' : 'modern-ssh-host-key',
    showHidden ? 'hidden' : 'visible',
    scope === 'remote' ? normalizeConnectionPath(path) : path,
  ].join('|');
}

function mergeConnectionCredentials(
  base: ConnectionDraft,
  source?: Pick<ConnectionDraft, 'username' | 'password'> | null,
): ConnectionDraft {
  if (!source) {
    return base;
  }

  const sourceUsername = source.username?.trim() ?? '';
  const sourcePassword = source.password ?? '';
  const nextUsername = base.username?.trim() || sourceUsername;
  const nextPassword = base.password ?? '';

  return {
    ...base,
    username: nextUsername,
    password: nextPassword || (nextUsername ? sourcePassword : ''),
  };
}

function needsConnectionDialog(connection: ConnectionDraft): boolean {
  const username = connection.username?.trim() ?? '';
  const password = connection.password ?? '';
  if (!username) {
    return true;
  }

  if (connection.protocol === 'FTP' || connection.protocol === 'FTPS' || connection.protocol === 'WebDAV') {
    return !password;
  }

  return isIpv4Host(connection.host) && !password;
}

function normalizeConnectionPath(path?: string | null): string {
  const trimmed = path?.trim() ?? '';
  if (!trimmed) {
    return '/';
  }

  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return `/${trimmed.replaceAll('\\', '/')}`;
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function normalizeConnectionPaths(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return paths
    .map((path) => normalizeConnectionPath(path))
    .filter((path) => {
      if (seen.has(path)) {
        return false;
      }

      seen.add(path);
      return true;
    });
}

function connectionDirectoryPaths(connection: Pick<ConnectionDraft, 'path' | 'paths'>): string[] {
  return normalizeConnectionPaths([connection.path, ...(connection.paths ?? [])]);
}

function withConnectionDirectory(connection: ConnectionDraft, path: string): ConnectionDraft {
  const normalizedPath = normalizeConnectionPath(path);
  return {
    ...connection,
    path: normalizedPath,
    paths: normalizeConnectionPaths([normalizedPath, ...(connection.paths ?? [])]),
  };
}

function favoriteMatchesConnection(favorite: FavoriteItem, connection: ConnectionDraft): boolean {
  const favoritePaths = connectionDirectoryPaths(favorite);
  const connectionPaths = connectionDirectoryPaths(connection);

  return (
    favorite.protocol === connection.protocol &&
    normalizedConnectionHost(favorite.host) === normalizedConnectionHost(connection.host) &&
    String(favorite.port ?? '') === String(connection.port ?? '').trim() &&
    favoritePaths.some((path) => connectionPaths.includes(path))
  );
}

function resolveSavedFavoriteId(records: FavoriteItem[], connection: ConnectionDraft): string | null {
  return records.find((record) => favoriteMatchesConnection(record, connection))?.id ?? null;
}

function connectionMatchesRemoteSession(connection: ConnectionDraft, state: RemoteSessionState): boolean {
  try {
    const keys = new Set([
      buildRemoteSpec(connection),
      buildRemoteSpec(connection, { includePath: true }),
    ]);
    if (keys.has(state.key)) {
      return true;
    }
  } catch {
    // Fall through to endpoint matching for incomplete or partially hydrated drafts.
  }

  return (
    state.connected &&
    state.protocol.toLowerCase() === connection.protocol.toLowerCase() &&
    normalizedConnectionHost(state.endpoint) === normalizedConnectionHost(connection.host)
  );
}

function preserveFavoriteTabOrder(current: FavoriteItem[], incoming: FavoriteItem[]): FavoriteItem[] {
  if (current.length === 0) {
    return incoming;
  }

  const incomingById = new Map(incoming.map((favorite) => [favorite.id, favorite]));
  const ordered: FavoriteItem[] = [];
  const seen = new Set<string>();

  current.forEach((favorite) => {
    const nextFavorite = incomingById.get(favorite.id);
    if (!nextFavorite) {
      return;
    }

    ordered.push(nextFavorite);
    seen.add(favorite.id);
  });

  incoming.forEach((favorite) => {
    if (seen.has(favorite.id)) {
      return;
    }

    ordered.push(favorite);
  });

  return ordered;
}

function sameConnectionEndpoint(left: ConnectionDraft, right: ConnectionDraft): boolean {
  return (
    left.protocol === right.protocol &&
    normalizedConnectionHost(left.host) === normalizedConnectionHost(right.host) &&
    String(left.port ?? '').trim() === String(right.port ?? '').trim() &&
    (left.username?.trim() ?? '') === (right.username?.trim() ?? '')
  );
}

function describeConnectionFailure(detail: string): UiNotice {
  const normalized = detail.toLowerCase();

  if (isLegacySshCompatibilityError(detail)) {
    return {
      tone: 'error',
      title: 'SSH 算法不兼容',
      detail: '这台服务器只提供较旧的 ssh-rsa/ssh-dss 主机密钥。rTerm 会自动尝试旧 SSH 兼容；长期建议升级服务端 SSH。',
    };
  }

  if (
    normalized.includes('connection reset by peer') ||
    normalized.includes('ssh connection failed: io(')
  ) {
    return {
      tone: 'error',
      title: '连接被远端重置',
      detail: '远端在 SSH 握手阶段主动断开了连接。已带回配置面板，请确认用户名、密码或认证方式后再试。',
    };
  }

  if (normalized.includes('permission denied')) {
    return {
      tone: 'error',
      title: '认证失败',
      detail: '用户名或密码没有通过远端校验。已带回配置面板，请重新确认登录信息。',
    };
  }

  if (normalized.includes('disconnect')) {
    return {
      tone: 'error',
      title: '连接被远端拒绝',
      detail: '远端没有接受当前这组 SSH 认证参数。已带回配置面板，请检查密码、SSH 配置或服务端策略。',
    };
  }

  return {
    tone: 'error',
    title: '无法进入工作台',
    detail,
  };
}

function isSshConnection(connection: ConnectionDraft): boolean {
  return connection.protocol === 'SFTP' || connection.protocol === 'SCP';
}

function isLegacySshCompatibilityError(detail: string): boolean {
  const normalized = detail.toLowerCase();

  return (
    normalized.includes('nocommonalgo') ||
    normalized.includes('no matching host key type') ||
    normalized.includes('host key algorithm') ||
    normalized.includes('their offer: ssh-rsa') ||
    normalized.includes('their offer: ssh-dss') ||
    (normalized.includes('ssh-rsa') && normalized.includes('ssh-dss'))
  );
}

function withLegacySshCompatibility(connection: ConnectionDraft): ConnectionDraft {
  return {
    ...connection,
    legacySshHostKeyAlgorithms: true,
  };
}

function createRemoteBrowserPlaceholder(connection: ConnectionDraft): BrowseListData {
  return {
    source: 'remote',
    endpoint: connection.host.trim() || '未连接',
    directory: normalizeConnectionPath(connection.path),
    totalEntries: 0,
    visibleEntries: 0,
    entries: [],
  };
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

function selectEntryPathRange(entries: BrowseEntry[], anchorPath: string | null, targetPath: string): string[] {
  if (!anchorPath) {
    return [targetPath];
  }

  const anchorIndex = entries.findIndex((entry) => entry.path === anchorPath);
  const targetIndex = entries.findIndex((entry) => entry.path === targetPath);

  if (anchorIndex < 0 || targetIndex < 0) {
    return [targetPath];
  }

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return entries.slice(start, end + 1).map((entry) => entry.path);
}

function conflictKindLabel(kind: TransferConflictItem['kind']): string {
  return kind === 'typeMismatch' ? '类型不同' : '已有同名文件';
}

function transferNoticeTitle(
  direction: TransferDirection,
  phase: 'running' | 'done' | 'failed' | 'refreshFailed' | 'batchDone',
): string {
  const label =
    direction === 'upload' ? '上传' : direction === 'download' ? '下载' : '远端复制';

  if (phase === 'running') {
    return `正在${label}`;
  }

  if (phase === 'failed') {
    return `${label}失败`;
  }

  if (phase === 'refreshFailed') {
    return `${label}完成，刷新失败`;
  }

  if (phase === 'batchDone') {
    return direction === 'remoteCopy' ? '批量远端复制已完成' : `批量${label}已完成`;
  }

  return `${label}完成`;
}

function scopeLabel(scope: FileMutationScope): string {
  return scope === 'local' ? '本地' : '远端';
}

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

function extensionOf(path: string): string {
  const normalized = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
  const baseName = normalized.split('/').pop() ?? normalized;

  if (baseName.startsWith('.') && !baseName.slice(1).includes('.')) {
    return baseName.toLowerCase();
  }

  const lastDot = baseName.lastIndexOf('.');
  return lastDot >= 0 ? baseName.slice(lastDot + 1).toLowerCase() : '';
}

function defaultFileAction(path: string): 'preview' | 'open' {
  const extension = extensionOf(path);
  const previewExtensions = new Set([
    'txt',
    'md',
    'markdown',
    'log',
    'json',
    'yaml',
    'yml',
    'toml',
    'ini',
    'conf',
    'csv',
    'ts',
    'tsx',
    'js',
    'jsx',
    'mjs',
    'cjs',
    'rs',
    'py',
    'go',
    'java',
    'kt',
    'swift',
    'css',
    'scss',
    'html',
    'xml',
    'svg',
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'pdf',
    '.env',
    '.gitignore',
  ]);

  return previewExtensions.has(extension) ? 'preview' : 'open';
}

function parentDirectoryOfPath(path: string): string | null {
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

function joinDialogPath(directory: string, name: string): string {
  if (directory === '/' || directory === '~') {
    return `${directory}/${name}`.replace('//', '/');
  }

  return `${directory}/${name}`;
}

function suggestDuplicateName(name: string, kind: BrowseEntry['kind']): string {
  if (kind === 'directory') {
    return `${name}-copy`;
  }

  if (name.startsWith('.') && !name.slice(1).includes('.')) {
    return `${name}-copy`;
  }

  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0) {
    return `${name}-copy`;
  }

  return `${name.slice(0, lastDot)}-copy${name.slice(lastDot)}`;
}

function suggestCopyDestination(entry: BrowseEntry): string {
  const parent = parentDirectoryOfPath(entry.path);
  const suggestedName = suggestDuplicateName(entry.name, entry.kind);
  return parent ? joinDialogPath(parent, suggestedName) : suggestedName;
}

type ActivePageProps = {
  styleMode: RTermStyleMode;
  onToggleStyleMode: () => void;
};

function ActivePage({ styleMode, onToggleStyleMode }: ActivePageProps) {
  const [draft, setDraft] = useState<ConnectionDraft>(emptyDraft);
  const [showHiddenFiles, setShowHiddenFiles] = useLocalStorageState('rterm.workbench.showHidden', false);
  const [recentConnections, setRecentConnections] = useState<RecentConnectionRecord[]>([]);
  const [favoriteConnections, setFavoriteConnections] = useState<FavoriteItem[]>([]);
  const [selectedFavoriteId, setSelectedFavoriteId] = useState<string | null>(null);
  const [hasLoadedRecents, setHasLoadedRecents] = useState(false);
  const [hasLoadedFavorites, setHasLoadedFavorites] = useState(false);
  const [notice, setNotice] = useState<UiNotice | null>(null);
  const [connectionResult, setConnectionResult] = useState<ConnectionTestResult | null>(null);
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('preview');
  const [workbenchState, setWorkbenchState] = useState<WorkbenchState | null>(null);
  const [remoteSessionStates, setRemoteSessionStates] = useState<RemoteSessionState[]>([]);
  const [browserPaneErrors, setBrowserPaneErrors] = useState<BrowserPaneErrors>({
    local: null,
    remote: null,
  });
  const [isRemoteBrowserConnected, setIsRemoteBrowserConnected] = useState(false);
  const [activeConnection, setActiveConnection] = useState<ConnectionDraft | null>(null);
  const [selectedLocalPath, setSelectedLocalPath] = useState<string | null>(null);
  const [selectedRemotePath, setSelectedRemotePath] = useState<string | null>(null);
  const [selectedLocalPaths, setSelectedLocalPaths] = useState<string[]>([]);
  const [selectedRemotePaths, setSelectedRemotePaths] = useState<string[]>([]);
  const { transferQueue, setTransferQueue, cancelledTransferIdsRef } = useTransferQueue();
  const [localTerminalDirectory, setLocalTerminalDirectory] = useState('');
  const [remoteTerminalDirectory, setRemoteTerminalDirectory] = useState('');
  const [terminalHistory, setTerminalHistory] = useState<TerminalHistoryEntry[]>([]);
  const [remoteTerminalHistory, setRemoteTerminalHistory] = useState<TerminalHistoryEntry[]>([]);
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null);
  const [terminalSessionScope, setTerminalSessionScope] = useState<TerminalScope | null>(null);
  const [terminalOutput, setTerminalOutput] = useState('');
  const [terminalDebugEntries, setTerminalDebugEntries] = useState<string[]>([]);
  const [terminalCompletionConfigFile, setTerminalCompletionConfigFile] = useState<TerminalCompletionConfigFile>({
    path: null,
    config: defaultTerminalCompletionConfig,
  });
  const [favoriteTerminalSessions, setFavoriteTerminalSessions] = useState<
    Record<string, FavoriteTerminalSessionState>
  >({});
  const [isStartingTerminal, setIsStartingTerminal] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isOpeningWorkbench, setIsOpeningWorkbench] = useState(false);
  const [openingConnectionId, setOpeningConnectionId] = useState<string | null>(null);
  const [isRefreshingWorkbench, setIsRefreshingWorkbench] = useState(false);
  const [isRefreshingLocal, setIsRefreshingLocal] = useState(false);
  const [isRefreshingRemote, setIsRefreshingRemote] = useState(false);
  const [isSavingFavorite, setIsSavingFavorite] = useState(false);
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const [pendingFavoriteRemoval, setPendingFavoriteRemoval] = useState<FavoriteItem | null>(null);
  const [pendingTransferConflict, setPendingTransferConflict] = useState<PendingTransferConflict | null>(null);
  const [pendingRemoteCopy, setPendingRemoteCopy] = useState<PendingRemoteCopy | null>(null);
  const [remoteCopyTargetFavoriteId, setRemoteCopyTargetFavoriteId] = useState('');
  const [remoteCopyTargetDirectory, setRemoteCopyTargetDirectory] = useState('/');
  const [pendingFilePreview, setPendingFilePreview] = useState<PendingFilePreview | null>(null);
  const [pendingFileDigest, setPendingFileDigest] = useState<PendingFileDigest | null>(null);
  const [pendingFileMutation, setPendingFileMutation] = useState<PendingFileMutation | null>(null);
  const [isLoadingFilePreview, setIsLoadingFilePreview] = useState(false);

  const clearBrowserPaneError = (scope: FileMutationScope) => {
    setBrowserPaneErrors((current) => (current[scope] ? { ...current, [scope]: null } : current));
  };

  const setBrowserPaneError = (scope: FileMutationScope, path: string, message: string) => {
    setBrowserPaneErrors((current) => ({
      ...current,
      [scope]: {
        path: path.trim() || '/',
        message,
      },
    }));
  };
  const [isCalculatingDigest, setIsCalculatingDigest] = useState(false);
  const [isSavingFilePreview, setIsSavingFilePreview] = useState(false);
  const [filePreviewValue, setFilePreviewValue] = useState('');
  const [savedFilePreviewValue, setSavedFilePreviewValue] = useState('');
  const [fileMutationValue, setFileMutationValue] = useState('');
  const [isMutatingFiles, setIsMutatingFiles] = useState(false);
  const {
    pendingSearch,
    setPendingSearch,
    searchQueryValue,
    setSearchQueryValue,
    isSearching,
    openSearchDialog: openSearch,
    cancelRunningSearch,
    clearSearch,
    dismissSearch,
    runSearch,
  } = useWorkbenchSearch({
    activeConnection,
    showHiddenFiles,
    ignorePatterns: terminalCompletionConfigFile.config.privacy.ignorePatterns,
    onError: (message) => {
      setNotice({
        tone: 'error',
        title: '搜索失败',
        detail: message,
      });
    },
  });
  const connectionCredentialsRef = useRef<Record<string, Pick<ConnectionDraft, 'username' | 'password'>>>(
    readDevConnectionCredentials(),
  );
  const workbenchSnapshotsRef = useRef<Record<string, WorkbenchSnapshot>>({});
  const [workbenchSnapshotVersion, setWorkbenchSnapshotVersion] = useState(0);
  const navigationKeyRef = useRef<string | null>(null);
  const previewRequestRef = useRef(0);
  const terminalSessionRef = useRef<string | null>(null);
  const terminalSessionScopeRef = useRef<TerminalScope | null>(null);
  const favoriteTerminalSessionsRef = useRef<Record<string, FavoriteTerminalSessionState>>({});
  const terminalSessionOwnerByIdRef = useRef<Record<string, string>>({});
  const autoRemoteTerminalKeyRef = useRef<string | null>(null);
  const browseCacheRef = useRef<Record<string, BrowseCacheEntry>>({});
  const browseRequestSequenceRef = useRef(0);

  const canSubmitConnection = draft.host.trim().length > 0;
  const canUseRemoteTerminal = supportsRemoteTerminal(activeConnection);
  const selectedLocalEntry =
    selectedLocalPath && workbenchState
      ? workbenchState.local.entries.find((entry) => entry.path === selectedLocalPath) ?? null
      : null;
  const selectedRemoteEntry =
    selectedRemotePath && workbenchState
      ? workbenchState.remote.entries.find((entry) => entry.path === selectedRemotePath) ?? null
      : null;
  const selectedLocalEntries = workbenchState
    ? workbenchState.local.entries.filter((entry) => selectedLocalPaths.includes(entry.path))
    : [];
  const selectedRemoteEntries = workbenchState
    ? workbenchState.remote.entries.filter((entry) => selectedRemotePaths.includes(entry.path))
    : [];
  const isEditableFilePreview = Boolean(
    pendingFilePreview?.result &&
      pendingFilePreview.result.kind === 'text' &&
      !pendingFilePreview.result.isBinary &&
      !pendingFilePreview.result.truncated,
  );
  const isFilePreviewDirty = isEditableFilePreview && filePreviewValue !== savedFilePreviewValue;

  const readBrowseCache = (
    connection: ConnectionDraft,
    scope: FileMutationScope,
    path: string,
    showHidden: boolean,
  ): BrowseRuntimeResult | null => {
    const key = browseCacheKey(connection, scope, path, showHidden);
    const cached = browseCacheRef.current[key];
    if (!cached) {
      return null;
    }

    if (Date.now() - cached.cachedAt > BROWSE_CACHE_TTL_MS) {
      delete browseCacheRef.current[key];
      return null;
    }

    return {
      data: cached.data,
      runtimeMode: cached.runtimeMode,
    };
  };

  const rememberBrowseCache = (
    connection: ConnectionDraft,
    scope: FileMutationScope,
    path: string,
    showHidden: boolean,
    result: BrowseRuntimeResult,
  ) => {
    browseCacheRef.current[browseCacheKey(connection, scope, path, showHidden)] = {
      ...result,
      cachedAt: Date.now(),
    };
  };

  const clearBrowseCache = () => {
    browseCacheRef.current = {};
  };

  const rememberConnectionCredentials = (connection: ConnectionDraft) => {
    const username = connection.username?.trim() ?? '';
    const password = connection.password ?? '';
    if (!username && !password) {
      return;
    }

    const key = connectionEndpointKey(connection);
    const current = connectionCredentialsRef.current[key] ?? {};
    connectionCredentialsRef.current[key] = {
      username: username || current.username || '',
      password: password || current.password || '',
    };
    writeDevConnectionCredentials(connectionCredentialsRef.current);
  };

  const rememberFavoriteCredentials = (records: FavoriteItem[]) => {
    records.forEach((record) => {
      rememberConnectionCredentials(toDraftFromFavorite(record));
    });
  };

  const resolveFavoriteIdForConnection = (connection: ConnectionDraft | null | undefined) => {
    if (!connection) {
      return null;
    }

    return resolveSavedFavoriteId(favoriteConnections, connection);
  };

  const hydrateFavoritePassword = async (
    favorite: FavoriteItem,
    connection: ConnectionDraft,
  ): Promise<ConnectionDraft> => {
    if (connection.password?.trim()) {
      return connection;
    }

    try {
      const result = await loadFavoritePassword(favorite.id);
      const password = result.data?.trim() ?? '';
      if (!password) {
        return connection;
      }

      const nextConnection = {
        ...connection,
        password,
      };
      rememberConnectionCredentials(nextConnection);
      setFavoriteConnections((current) =>
        current.map((record) =>
          record.id === favorite.id ? { ...record, password } : record,
        ),
      );
      setDraft((current) =>
        sameConnectionEndpoint(current, connection)
          ? {
              ...current,
              password,
            }
          : current,
      );
      setActiveConnection((current) =>
        current && sameConnectionEndpoint(current, connection)
          ? {
              ...current,
              password,
            }
          : current,
      );

      const snapshot = workbenchSnapshotsRef.current[favorite.id];
      if (snapshot) {
        workbenchSnapshotsRef.current[favorite.id] = {
          ...snapshot,
          connection: {
            ...snapshot.connection,
            password,
          },
        };
      }

      return nextConnection;
    } catch {
      return connection;
    }
  };

  const hydrateFavoritePasswordsFromStore = async (
    records: FavoriteItem[],
  ): Promise<FavoriteItem[]> => {
    const hydratedRecords = await Promise.all(
      records.map(async (record) => {
        if (record.password?.trim()) {
          return record;
        }

        try {
          const result = await loadFavoritePassword(record.id);
          const password = result.data?.trim() ?? '';
          return password ? { ...record, password } : record;
        } catch {
          return record;
        }
      }),
    );

    return hydratedRecords;
  };

  const persistFavoritePasswordIfNeeded = (connection: ConnectionDraft) => {
    const password = connection.password ?? '';
    if (!password.trim()) {
      return;
    }

    const favorite = favoriteConnections.find((record) => favoriteMatchesConnection(record, connection));
    if (!favorite || favorite.password === password) {
      return;
    }

    const favoriteConnection = toDraftFromFavorite(favorite);
    const nextConnection: ConnectionDraft = {
      ...mergeConnectionCredentials(favoriteConnection, connection),
      path: normalizeConnectionPath(favorite.path),
      paths: normalizeConnectionPaths([favorite.path, ...(favorite.paths ?? []), connection.path]),
    };

    void saveFavorite(nextConnection, favorite.name)
      .then((result) => {
        setHasLoadedFavorites(true);
        rememberFavoriteCredentials(result.data);
        setFavoriteConnections((current) => preserveFavoriteTabOrder(current, result.data));
      })
      .catch(() => {
        // Ignore password persistence failures and keep the current session usable.
      });
  };

  const hydrateConnectionDraft = (connection: ConnectionDraft) => {
    const key = connectionEndpointKey(connection);
    let next = mergeConnectionCredentials(connection, connectionCredentialsRef.current[key]);

    if (activeConnection && connectionEndpointKey(activeConnection) === key) {
      next = mergeConnectionCredentials(next, activeConnection);
    }

    if (connectionEndpointKey(draft) === key) {
      next = mergeConnectionCredentials(next, draft);
    }

    return next;
  };

  const withKnownConnectionCredentials = (connection: ConnectionDraft) => {
    const hydrated = hydrateConnectionDraft(connection);
    const matchingFavorite = favoriteConnections.find((record) => favoriteMatchesConnection(record, hydrated));
    if (!matchingFavorite) {
      return hydrated;
    }

    return mergeConnectionCredentials(hydrated, toDraftFromFavorite(matchingFavorite));
  };

  const markWorkbenchSnapshotsChanged = () => {
    setWorkbenchSnapshotVersion((current) => current + 1);
  };

  const snapshotVersion = workbenchSnapshotVersion;
  const favoriteConnectionStateById = Object.fromEntries(
    favoriteConnections.map((favorite) => {
      const hydratedFavorite = hydrateConnectionDraft(toDraftFromFavorite(favorite));
      const savedSnapshot = snapshotVersion >= 0 ? workbenchSnapshotsRef.current[favorite.id] ?? null : null;
      const isActiveFavorite = Boolean(
        activeConnection && favoriteMatchesConnection(favorite, activeConnection),
      );
      const isConnected = Boolean(
        (isActiveFavorite && isRemoteBrowserConnected && connectionResult?.connected) ||
          savedSnapshot?.remoteBrowserConnected ||
          remoteSessionStates.some(
            (state) => state.connected && connectionMatchesRemoteSession(hydratedFavorite, state),
          ),
      );
      const hasLiveTerminal = Boolean(favoriteTerminalSessions[favorite.id]);
      const isConnectingFiles = Boolean(isActiveFavorite && isRefreshingRemote);

      return [
        favorite.id,
        isConnectingFiles
          ? 'connecting'
          : hasLiveTerminal
          ? 'running'
          : isConnected
            ? 'connected'
            : needsConnectionDialog(hydratedFavorite)
              ? 'incomplete'
              : 'ready',
      ];
    }),
  ) as Record<string, 'running' | 'connecting' | 'connected' | 'ready' | 'incomplete'>;
  const favoriteRemotePoolSummaryById = Object.fromEntries(
    favoriteConnections.map((favorite) => {
      const hydratedFavorite = hydrateConnectionDraft(toDraftFromFavorite(favorite));
      const matchingStates = remoteSessionStates.filter((state) =>
        connectionMatchesRemoteSession(hydratedFavorite, state),
      );
      const latest =
        matchingStates.reduce<RemoteSessionState | null>(
          (current, state) => (!current || state.lastUsedAt > current.lastUsedAt ? state : current),
          null,
        ) ?? null;

      return [
        favorite.id,
        {
          total: matchingStates.length,
          connected: matchingStates.filter((state) => state.connected).length,
          latest,
        },
      ];
    }),
  );

  const openConnectionDialogWithDraft = (connection: ConnectionDraft, noticeValue: UiNotice) => {
    updateDraft(connection);
    setNotice(noticeValue);
    setIsConnectionDialogOpen(true);
  };

  const restoreTerminalStateForFavorite = (
    favoriteId: string | null,
    connection: ConnectionDraft | null,
    snapshot?: WorkbenchSnapshot | null,
  ) => {
    const liveSession = favoriteId ? favoriteTerminalSessionsRef.current[favoriteId] ?? null : null;
    const nextCanUseRemote = supportsRemoteTerminal(connection);
    const nextSessionId = nextCanUseRemote ? liveSession?.sessionId ?? snapshot?.terminalSessionId ?? null : null;
    const nextSessionScope = nextSessionId
      ? liveSession?.scope ?? snapshot?.terminalSessionScope ?? 'remote'
      : null;

    if (favoriteId && nextSessionId) {
      terminalSessionOwnerByIdRef.current[nextSessionId] = favoriteId;
      if (!liveSession) {
        const nextFavoriteSessions = {
          ...favoriteTerminalSessionsRef.current,
          [favoriteId]: {
            sessionId: nextSessionId,
            scope: nextSessionScope ?? 'remote',
          },
        };
        favoriteTerminalSessionsRef.current = nextFavoriteSessions;
        setFavoriteTerminalSessions(nextFavoriteSessions);
      }
    }

    setTerminalSessionId(nextSessionId);
    setTerminalSessionScope(nextSessionScope);
    setTerminalHistory(snapshot?.terminalHistory ?? []);
    setRemoteTerminalHistory(snapshot?.remoteTerminalHistory ?? []);
    setTerminalOutput(snapshot?.terminalOutput ?? '');
    setTerminalDebugEntries(snapshot?.terminalDebugEntries ?? []);
  };

  const storeWorkbenchSnapshot = (
    connection: ConnectionDraft,
    nextWorkbenchState: WorkbenchState,
    nextConnectionResult: ConnectionTestResult | null,
    nextLocalTerminalDirectory: string,
    nextRemoteTerminalDirectory: string,
    remoteBrowserConnected: boolean,
    terminalSnapshot?: Partial<Pick<
      WorkbenchSnapshot,
      | 'terminalScope'
      | 'terminalSessionId'
      | 'terminalSessionScope'
      | 'terminalHistory'
      | 'remoteTerminalHistory'
      | 'terminalOutput'
      | 'terminalDebugEntries'
    >>,
  ) => {
    const matchingFavoriteId = resolveSavedFavoriteId(favoriteConnections, connection);
    if (!matchingFavoriteId) {
      return;
    }

    workbenchSnapshotsRef.current[matchingFavoriteId] = {
      connection,
      workbenchState: nextWorkbenchState,
      connectionResult: nextConnectionResult,
      localTerminalDirectory: nextLocalTerminalDirectory,
      remoteTerminalDirectory: nextRemoteTerminalDirectory,
      remoteBrowserConnected,
      terminalScope: terminalSnapshot?.terminalScope ?? 'remote',
      terminalSessionId: terminalSnapshot?.terminalSessionId ?? terminalSessionId,
      terminalSessionScope: terminalSnapshot?.terminalSessionScope ?? terminalSessionScope,
      terminalHistory: terminalSnapshot?.terminalHistory ?? terminalHistory,
      remoteTerminalHistory: terminalSnapshot?.remoteTerminalHistory ?? remoteTerminalHistory,
      terminalOutput: terminalSnapshot?.terminalOutput ?? terminalOutput,
      terminalDebugEntries: terminalSnapshot?.terminalDebugEntries ?? terminalDebugEntries,
    };
    markWorkbenchSnapshotsChanged();
  };

  const persistActiveWorkbenchSnapshot = () => {
    if (!activeConnection || !workbenchState) {
      return;
    }

    storeWorkbenchSnapshot(
      activeConnection,
      workbenchState,
      connectionResult,
      localTerminalDirectory || workbenchState.local.directory,
      remoteTerminalDirectory || workbenchState.remote.directory,
      isRemoteBrowserConnected,
      {
        terminalScope: 'remote',
        terminalSessionId,
        terminalSessionScope,
        terminalHistory,
        remoteTerminalHistory,
        terminalOutput,
        terminalDebugEntries,
      },
    );
  };

  const handleSelectFavoriteTab = (favorite: FavoriteItem) => {
    const nextConnection = hydrateConnectionDraft(toDraftFromFavorite(favorite));
    const snapshot = workbenchSnapshotsRef.current[favorite.id];

    persistActiveWorkbenchSnapshot();

    setNotice(null);
    setBrowserPaneErrors({ local: null, remote: null });
    setSelectedFavoriteId(favorite.id);
    updateDraft(nextConnection);

    if (snapshot) {
      const hydratedSnapshotConnection = mergeConnectionCredentials(snapshot.connection, nextConnection);
      setRuntimeMode(snapshot.workbenchState.runtimeMode);
      setWorkbenchState(snapshot.workbenchState);
      setIsRemoteBrowserConnected(snapshot.remoteBrowserConnected);
      setActiveConnection(hydratedSnapshotConnection);
      setConnectionResult(snapshot.connectionResult);
      setSelectedLocalPaths([]);
      setSelectedRemotePaths([]);
      setSelectedLocalPath(null);
      setSelectedRemotePath(null);
      setLocalTerminalDirectory(snapshot.localTerminalDirectory || snapshot.workbenchState.local.directory);
      setRemoteTerminalDirectory(snapshot.remoteTerminalDirectory || snapshot.workbenchState.remote.directory);
      restoreTerminalStateForFavorite(favorite.id, hydratedSnapshotConnection, snapshot);
      void hydrateFavoritePassword(favorite, hydratedSnapshotConnection);
      return;
    }

    setActiveConnection(nextConnection);
    setConnectionResult(null);
    setWorkbenchState(null);
    setIsRemoteBrowserConnected(false);
    setSelectedLocalPaths([]);
    setSelectedRemotePaths([]);
    setSelectedLocalPath(null);
    setSelectedRemotePath(null);
    setLocalTerminalDirectory('');
    setRemoteTerminalDirectory('');
    restoreTerminalStateForFavorite(favorite.id, nextConnection, null);
    void hydrateFavoritePassword(favorite, nextConnection);
  };

  const handleOpenFavoriteConfig = async (favorite: FavoriteItem) => {
    const hydratedFavorite = await hydrateFavoritePassword(
      favorite,
      hydrateConnectionDraft(toDraftFromFavorite(favorite)),
    );
    openConnectionDialogWithDraft(hydratedFavorite, {
      tone: 'info',
      title: `正在编辑 ${favorite.name}`,
      detail: '连接参数已带入面板，可以继续调整后再连接。',
    });
  };

  const handleRenameFavoriteFromTab = (favorite: FavoriteItem) => {
    const nextName = window.prompt('重命名收藏', favorite.name);
    if (!nextName) {
      return;
    }

    const normalized = nextName.trim();
    if (!normalized || normalized === favorite.name) {
      return;
    }

    handleRenameFavorite(favorite.id, normalized);
  };

  const handleRemoveFavoriteFromTab = (favorite: FavoriteItem) => {
    setPendingFavoriteRemoval(favorite);
  };

  const closeFavoriteTerminalSession = (favorite: FavoriteItem, failureTitle: string): boolean => {
    const snapshot = workbenchSnapshotsRef.current[favorite.id];
    const liveSession =
      favoriteTerminalSessionsRef.current[favorite.id] ??
      (snapshot?.terminalSessionId
        ? {
            sessionId: snapshot.terminalSessionId,
            scope: snapshot.terminalSessionScope ?? ('remote' as TerminalScope),
          }
        : null);
    if (!liveSession) {
      return false;
    }

    delete terminalSessionOwnerByIdRef.current[liveSession.sessionId];
    const nextFavoriteSessions = Object.fromEntries(
      Object.entries(favoriteTerminalSessionsRef.current).filter(
        ([favoriteId]) => favoriteId !== favorite.id,
      ),
    );
    favoriteTerminalSessionsRef.current = nextFavoriteSessions;
    setFavoriteTerminalSessions(nextFavoriteSessions);

    if (snapshot) {
      snapshot.terminalSessionId = null;
      snapshot.terminalSessionScope = null;
      markWorkbenchSnapshotsChanged();
    }

    if (terminalSessionRef.current === liveSession.sessionId) {
      terminalSessionRef.current = null;
      terminalSessionScopeRef.current = null;
      setTerminalSessionId(null);
      setTerminalSessionScope(null);
    }

    void closeTerminalSession(liveSession.sessionId).catch((error) => {
      setNotice({
        tone: 'error',
        title: failureTitle,
        detail: error instanceof Error ? error.message : '无法关闭该主机的终端会话。',
      });
    });

    return true;
  };

  const handleCloseFavoriteTerminal = (favorite: FavoriteItem) => {
    closeFavoriteTerminalSession(favorite, '关闭终端失败');
  };

  const handleDisconnectFavoriteConnection = (favorite: FavoriteItem) => {
    const snapshot = workbenchSnapshotsRef.current[favorite.id] ?? null;
    const isActiveFavorite = Boolean(
      activeConnection && favoriteMatchesConnection(favorite, activeConnection),
    );
    const fallbackConnection = hydrateConnectionDraft(toDraftFromFavorite(favorite));
    const currentSnapshotConnection = snapshot?.connection ?? fallbackConnection;
    const nextConnection = {
      ...currentSnapshotConnection,
      path:
        snapshot?.workbenchState.remote.directory ||
        (isActiveFavorite ? workbenchState?.remote.directory : null) ||
        currentSnapshotConnection.path,
    };
    const nextSnapshotState = snapshot?.workbenchState
      ? {
          ...snapshot.workbenchState,
          remote: createRemoteBrowserPlaceholder(nextConnection),
        }
      : null;

    closeFavoriteTerminalSession(favorite, '断开终端失败');

    if (snapshot) {
      snapshot.connection = nextConnection;
      if (nextSnapshotState) {
        snapshot.workbenchState = nextSnapshotState;
      }
      snapshot.connectionResult = null;
      snapshot.remoteBrowserConnected = false;
      markWorkbenchSnapshotsChanged();
    }

    if (isActiveFavorite) {
      const nextActiveWorkbenchState =
        nextSnapshotState ??
        (workbenchState
          ? {
              ...workbenchState,
              remote: createRemoteBrowserPlaceholder(nextConnection),
            }
          : null);

      setSelectedRemotePaths([]);
      setSelectedRemotePath(null);
      setActiveConnection(nextConnection);
      setConnectionResult(null);
      setIsRemoteBrowserConnected(false);
      clearBrowserPaneError('remote');
      if (nextActiveWorkbenchState) {
        setWorkbenchState(nextActiveWorkbenchState);
      }
    }

    setNotice({
      tone: 'info',
      title: '连接已断开',
      detail: favorite.name || `${favorite.host}${favorite.port ? `:${favorite.port}` : ''}`,
    });
  };

  useEffect(() => {
    let active = true;

    void Promise.all([loadRecentConnections(), loadFavorites()])
      .then(async ([recentResult, favoriteResult]) => {
        if (!active) {
          return;
        }

        const hydratedFavorites = await hydrateFavoritePasswordsFromStore(favoriteResult.data);
        if (!active) {
          return;
        }

        setRecentConnections(recentResult.data);
        rememberFavoriteCredentials(hydratedFavorites);
        setFavoriteConnections((current) => preserveFavoriteTabOrder(current, hydratedFavorites));
        setHasLoadedRecents(true);
        setHasLoadedFavorites(true);
      })
      .catch(() => {
        // Ignore session bootstrap failures for now.
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (favoriteConnections.length === 0) {
      if (selectedFavoriteId !== null) {
        setSelectedFavoriteId(null);
      }
      return;
    }

    if (selectedFavoriteId && favoriteConnections.some((favorite) => favorite.id === selectedFavoriteId)) {
      return;
    }

    const activeMatch = activeConnection
      ? favoriteConnections.find(
          (favorite) =>
            favorite.host === activeConnection.host &&
            (favorite.port == null ? '' : String(favorite.port)) === (activeConnection.port ?? '') &&
            favorite.path === activeConnection.path,
        )
      : null;

    setSelectedFavoriteId(activeMatch?.id ?? null);
  }, [activeConnection, favoriteConnections, selectedFavoriteId]);

  useEffect(() => {
    let active = true;

    const refreshRemotePoolStates = () => {
      void listRemoteSessionStates()
        .then((result) => {
          if (active) {
            setRemoteSessionStates(result.data);
          }
        })
        .catch(() => {
          if (active) {
            setRemoteSessionStates([]);
          }
        });
    };

    refreshRemotePoolStates();
    const interval = window.setInterval(refreshRemotePoolStates, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    terminalSessionRef.current = terminalSessionId;
  }, [terminalSessionId]);

  useEffect(() => {
    terminalSessionScopeRef.current = terminalSessionScope;
  }, [terminalSessionScope]);

  useEffect(() => {
    favoriteTerminalSessionsRef.current = favoriteTerminalSessions;
  }, [favoriteTerminalSessions]);

  const appendTerminalDebug = (message: string) => {
    const timestamp = new Date().toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setTerminalDebugEntries((current) => [`${timestamp} ${message}`, ...current].slice(0, 12));
  };

  const loadInitialTerminalCompletionConfig = async () => {
    try {
      const result = await loadTerminalCompletionConfig();
      setTerminalCompletionConfigFile(result.data);
    } catch (error) {
      setNotice({
        tone: 'error',
        title: '补全配置加载失败',
        detail: error instanceof Error ? error.message : '请检查 completion.json 是否为合法 JSON，修复后重启 rTerm。',
      });
    }
  };

  useEffect(() => {
    void loadInitialTerminalCompletionConfig();
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenOutput: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let unlistenDebug: (() => void) | null = null;

    void subscribeTerminalOutput((event: TerminalOutputEvent) => {
      const ownerFavoriteId = terminalSessionOwnerByIdRef.current[event.sessionId];
      if (ownerFavoriteId) {
        const snapshot = workbenchSnapshotsRef.current[ownerFavoriteId];
        if (snapshot) {
          snapshot.terminalSessionId = event.sessionId;
          snapshot.terminalSessionScope =
            favoriteTerminalSessionsRef.current[ownerFavoriteId]?.scope ?? snapshot.terminalSessionScope;
          snapshot.terminalOutput = `${snapshot.terminalOutput}${event.chunk}`.slice(-12000);
        }
      }

      if (terminalSessionRef.current === event.sessionId) {
        setTerminalOutput((current) => `${current}${event.chunk}`.slice(-12000));
      }
    }).then((disposeListener) => {
      if (disposed) {
        disposeListener();
        return;
      }

      unlistenOutput = disposeListener;
    }).catch((error) => {
      if (disposed) {
        return;
      }

      setNotice({
        tone: 'error',
        title: '终端事件订阅失败',
        detail: error instanceof Error ? error.message : '无法监听终端输出事件。',
      });
    });

    void subscribeTerminalExit((event: TerminalExitEvent) => {
      const ownerFavoriteId = terminalSessionOwnerByIdRef.current[event.sessionId] ?? null;
      const wasActiveSession = terminalSessionRef.current === event.sessionId;
      if (ownerFavoriteId) {
        delete terminalSessionOwnerByIdRef.current[event.sessionId];
        favoriteTerminalSessionsRef.current = Object.fromEntries(
          Object.entries(favoriteTerminalSessionsRef.current).filter(
            ([favoriteId]) => favoriteId !== ownerFavoriteId,
          ),
        );
        setFavoriteTerminalSessions(favoriteTerminalSessionsRef.current);

        const snapshot = workbenchSnapshotsRef.current[ownerFavoriteId];
        if (snapshot) {
          snapshot.terminalSessionId = null;
          snapshot.terminalSessionScope = null;
          snapshot.terminalOutput = `${snapshot.terminalOutput}[远端会话已结束${
            event.exitCode == null ? '' : `，退出码 ${event.exitCode}`
          }]\n`.slice(-12000);
        }
      }

      if (wasActiveSession) {
        setTerminalSessionId(null);
        setTerminalSessionScope(null);
      }
      if (wasActiveSession) {
        const scopeLabel = terminalSessionScopeRef.current === 'remote' ? '远端' : '终端';
        terminalSessionRef.current = null;
        terminalSessionScopeRef.current = null;
        setTerminalOutput((current) =>
          `${current}[${scopeLabel}会话已结束${event.exitCode == null ? '' : `，退出码 ${event.exitCode}`}]\n`.slice(-12000),
        );
      }
    }).then((disposeListener) => {
      if (disposed) {
        disposeListener();
        return;
      }

      unlistenExit = disposeListener;
    }).catch((error) => {
      if (disposed) {
        return;
      }

      setNotice({
        tone: 'error',
        title: '终端事件订阅失败',
        detail: error instanceof Error ? error.message : '无法监听终端退出事件。',
      });
    });

    void subscribeTerminalDebug((event: TerminalDebugEvent) => {
      const nextEntry = `[${event.stage}] ${event.message}`;
      const ownerFavoriteId = terminalSessionOwnerByIdRef.current[event.sessionId];
      if (ownerFavoriteId) {
        const snapshot = workbenchSnapshotsRef.current[ownerFavoriteId];
        if (snapshot) {
          snapshot.terminalDebugEntries = [nextEntry, ...snapshot.terminalDebugEntries].slice(0, 12);
        }
      }
      if (terminalSessionRef.current === event.sessionId) {
        appendTerminalDebug(nextEntry);
      }
    }).then((disposeListener) => {
      if (disposed) {
        disposeListener();
        return;
      }

      unlistenDebug = disposeListener;
    }).catch((error) => {
      if (disposed) {
        return;
      }

      setNotice({
        tone: 'error',
        title: '终端调试事件订阅失败',
        detail: error instanceof Error ? error.message : '无法监听终端调试事件。',
      });
    });

    return () => {
      disposed = true;
      unlistenOutput?.();
      unlistenExit?.();
      unlistenDebug?.();
    };
  }, []);

  const updateDraft = (nextDraft: ConnectionDraft) => {
    setDraft(nextDraft);
    setConnectionResult(null);
  };

  const rememberConnection = (nextDraft: ConnectionDraft, resolvedPath?: string) => {
    void rememberRecentConnection(nextDraft, resolvedPath)
      .then((result) => {
        setHasLoadedRecents(true);
        setRecentConnections(result.data);
      })
      .catch(() => {
        // Ignore persistence failures while the workbench shell is evolving.
      });
  };

  const openConnectionDialog = () => {
    setDraft(activeConnection ?? draft);
    setIsConnectionDialogOpen(true);
  };

  const closeConnectionDialog = () => {
    setIsConnectionDialogOpen(false);
  };

  const handlePinRecent = (session: SessionItem) => {
    setIsSavingFavorite(true);
    const connection = toDraft(session);
    void saveFavorite(connection)
      .then((result) => {
        setHasLoadedFavorites(true);
        rememberFavoriteCredentials(result.data);
        setFavoriteConnections((current) => preserveFavoriteTabOrder(current, result.data));
        setSelectedFavoriteId(resolveSavedFavoriteId(result.data, connection));
        setNotice({
          tone: 'success',
          title: '配置已保存',
          detail: `${session.host} · ${session.path}`,
        });
      })
      .catch((error) => {
        setNotice({
          tone: 'error',
          title: '保存配置失败',
          detail: error instanceof Error ? error.message : '未能保存配置。',
        });
      })
      .finally(() => {
        setIsSavingFavorite(false);
      });
  };

  const handleSaveDraftFavorite = () => {
    if (!canSubmitConnection) {
      setNotice({
        tone: 'error',
        title: '还不能保存配置',
        detail: '先填写主机和路径，再把它保存成配置。',
      });
      return;
    }

    const hydratedDraft = withKnownConnectionCredentials(draft);
    const existingFavorite = favoriteConnections.find((record) => favoriteMatchesConnection(record, hydratedDraft));
    const favoriteToSave: ConnectionDraft = existingFavorite
      ? {
          ...hydratedDraft,
          path: normalizeConnectionPath(existingFavorite.path),
          paths: normalizeConnectionPaths([
            existingFavorite.path,
            ...(existingFavorite.paths ?? []),
            hydratedDraft.path,
            ...(hydratedDraft.paths ?? []),
          ]),
        }
      : {
          ...hydratedDraft,
          path: normalizeConnectionPath(hydratedDraft.path),
          paths: normalizeConnectionPaths([hydratedDraft.path, ...(hydratedDraft.paths ?? [])]),
        };

    setIsSavingFavorite(true);
    void saveFavorite(favoriteToSave, hydratedDraft.name?.trim() || existingFavorite?.name)
      .then((result) => {
        setHasLoadedFavorites(true);
        rememberFavoriteCredentials(result.data);
        setFavoriteConnections((current) => preserveFavoriteTabOrder(current, result.data));
        setSelectedFavoriteId(resolveSavedFavoriteId(result.data, favoriteToSave));
        rememberConnectionCredentials(favoriteToSave);
        persistFavoritePasswordIfNeeded(favoriteToSave);
        setNotice({
          tone: 'success',
          title: '当前配置已保存',
          detail: `${hydratedDraft.host.trim()} · ${hydratedDraft.path.trim() || '/'}`,
        });
      })
      .catch((error) => {
        setNotice({
          tone: 'error',
          title: '保存配置失败',
          detail: error instanceof Error ? error.message : '未能保存配置。',
        });
      })
      .finally(() => {
        setIsSavingFavorite(false);
      });
  };

  const handleImportFavorites = async (content: string) => {
    let importedDrafts: ConnectionDraft[];
    try {
      importedDrafts = parseFavoriteImportPayload(content);
    } catch (error) {
      setNotice({
        tone: 'error',
        title: '导入配置失败',
        detail: error instanceof Error ? error.message : '配置文件不是有效的 JSON。',
      });
      return;
    }

    if (importedDrafts.length === 0) {
      setNotice({
        tone: 'info',
        title: '没有可导入的配置',
      });
      return;
    }

    setIsSavingFavorite(true);
    try {
      let latestFavorites = favoriteConnections;
      for (const importedDraft of importedDrafts) {
        const result = await saveFavorite(importedDraft, importedDraft.name);
        latestFavorites = result.data;
        setRuntimeMode(result.runtimeMode);
      }

      setHasLoadedFavorites(true);
      rememberFavoriteCredentials(latestFavorites);
      setFavoriteConnections((current) => preserveFavoriteTabOrder(current, latestFavorites));
      const lastImportedDraft = importedDrafts[importedDrafts.length - 1];
      setSelectedFavoriteId(resolveSavedFavoriteId(latestFavorites, lastImportedDraft));
      setDraft(lastImportedDraft);
      setConnectionResult(null);
      setNotice({
        tone: 'success',
        title: `已导入 ${importedDrafts.length} 个主机配置`,
        detail: '导入文件中的密码字段会写入本机保存；导出文件默认不包含密码。',
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: '导入配置失败',
        detail: error instanceof Error ? error.message : '未能保存导入的主机配置。',
      });
    } finally {
      setIsSavingFavorite(false);
    }
  };

  const handleExportFavorites = () => {
    if (favoriteConnections.length === 0) {
      setNotice({
        tone: 'info',
        title: '还没有可导出的配置',
      });
      return;
    }

    const payload = buildFavoriteExportPayload(favoriteConnections);
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    anchor.href = url;
    anchor.download = `rterm-hosts-${date}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice({
      tone: 'success',
      title: `已导出 ${favoriteConnections.length} 个主机配置`,
      detail: '导出文件不包含密码，避免明文外泄。',
    });
  };

  const handleRemoveRecent = (sessionId: string) => {
    void removeRecentConnection(sessionId)
      .then((result) => {
        setHasLoadedRecents(true);
        setRecentConnections(result.data);
        setNotice({
          tone: 'info',
          title: '已移出最近连接',
        });
      })
      .catch((error) => {
        setNotice({
          tone: 'error',
          title: '移除最近连接失败',
          detail: error instanceof Error ? error.message : '未能更新最近连接。',
        });
      });
  };

  const handleRemoveFavorite = (favoriteId: string) => {
    const favoriteToRemove = favoriteConnections.find((favorite) => favorite.id === favoriteId);
    const credentialKey = favoriteToRemove ? connectionEndpointKey(toDraftFromFavorite(favoriteToRemove)) : null;

    if (selectedFavoriteId === favoriteId) {
      setSelectedFavoriteId(null);
    }

    void removeFavorite(favoriteId)
      .then((result) => {
        setHasLoadedFavorites(true);
        setFavoriteConnections((current) => preserveFavoriteTabOrder(current, result.data));
        if (credentialKey) {
          delete connectionCredentialsRef.current[credentialKey];
          writeDevConnectionCredentials(connectionCredentialsRef.current);
        }
        delete workbenchSnapshotsRef.current[favoriteId];
        markWorkbenchSnapshotsChanged();
        const liveSession = favoriteTerminalSessionsRef.current[favoriteId];
        if (liveSession) {
          favoriteTerminalSessionsRef.current = Object.fromEntries(
            Object.entries(favoriteTerminalSessionsRef.current).filter(
              ([currentFavoriteId]) => currentFavoriteId !== favoriteId,
            ),
          );
          setFavoriteTerminalSessions(favoriteTerminalSessionsRef.current);
          delete terminalSessionOwnerByIdRef.current[liveSession.sessionId];
          if (terminalSessionRef.current === liveSession.sessionId) {
            terminalSessionRef.current = null;
            terminalSessionScopeRef.current = null;
            setTerminalSessionId(null);
            setTerminalSessionScope(null);
          }
          void closeTerminalSession(liveSession.sessionId).catch(() => {
            // Ignore cleanup failures while removing a favorite.
          });
        }
        setNotice({
          tone: 'info',
          title: '已移出收藏',
        });
      })
      .catch((error) => {
        setNotice({
          tone: 'error',
          title: '移除收藏失败',
          detail: error instanceof Error ? error.message : '未能更新收藏列表。',
        });
      });
  };

  const handleRequestRemoveFavorite = (favoriteOrId: FavoriteItem | string) => {
    const favorite =
      typeof favoriteOrId === 'string'
        ? favoriteConnections.find((record) => record.id === favoriteOrId)
        : favoriteOrId;

    if (!favorite) {
      if (typeof favoriteOrId === 'string') {
        handleRemoveFavorite(favoriteOrId);
      }
      return;
    }

    setPendingFavoriteRemoval(favorite);
  };

  const handleDismissFavoriteRemoval = () => {
    setPendingFavoriteRemoval(null);
  };

  const handleConfirmFavoriteRemoval = () => {
    const favorite = pendingFavoriteRemoval;
    if (!favorite) {
      return;
    }

    setPendingFavoriteRemoval(null);
    handleRemoveFavorite(favorite.id);
  };

  const handleRenameFavorite = (favoriteId: string, name: string) => {
    setIsSavingFavorite(true);
    void renameFavorite(favoriteId, name)
      .then((result) => {
        setHasLoadedFavorites(true);
        setFavoriteConnections((current) => preserveFavoriteTabOrder(current, result.data));
        setNotice({
          tone: 'success',
          title: '收藏名称已更新',
        });
      })
      .catch((error) => {
        setNotice({
          tone: 'error',
          title: '重命名收藏失败',
          detail: error instanceof Error ? error.message : '未能更新收藏名称。',
        });
      })
      .finally(() => {
        setIsSavingFavorite(false);
      });
  };

  const applyWorkbenchData = (
    connection: ConnectionDraft,
    result: Awaited<ReturnType<typeof loadWorkbench>>,
    terminalSnapshot?: Partial<
      Pick<
        WorkbenchSnapshot,
        | 'terminalScope'
        | 'terminalSessionId'
        | 'terminalSessionScope'
        | 'terminalHistory'
        | 'remoteTerminalHistory'
        | 'terminalOutput'
        | 'terminalDebugEntries'
      >
    >,
    cacheShowHidden = showHiddenFiles,
  ) => {
    const nextWorkbenchState = {
      ...result.data,
      runtimeMode: result.runtimeMode,
    };
    const nextConnection = {
      ...connection,
      path: result.data.remote.directory,
    };
    const nextConnectionResult = {
      protocol: connection.protocol,
      endpoint: connection.host.trim(),
      connected: true,
      workingDirectory: result.data.remote.directory,
      remotePath: result.data.remote.directory,
    };
    const nextLocalDirectory = nextWorkbenchState.local.directory;
    const nextRemoteDirectory = nextWorkbenchState.remote.directory;

    rememberBrowseCache(nextConnection, 'local', nextLocalDirectory, cacheShowHidden, {
      data: nextWorkbenchState.local,
      runtimeMode: result.runtimeMode,
    });
    rememberBrowseCache(nextConnection, 'remote', nextRemoteDirectory, cacheShowHidden, {
      data: nextWorkbenchState.remote,
      runtimeMode: result.runtimeMode,
    });

    setRuntimeMode(result.runtimeMode);
    setWorkbenchState(nextWorkbenchState);
    setSelectedLocalPaths((current) =>
      current.filter((path) => nextWorkbenchState.local.entries.some((entry) => entry.path === path)),
    );
    setSelectedRemotePaths((current) =>
      current.filter((path) => nextWorkbenchState.remote.entries.some((entry) => entry.path === path)),
    );
    setSelectedLocalPath((current) =>
      current && nextWorkbenchState.local.entries.some((entry) => entry.path === current) ? current : null,
    );
    setSelectedRemotePath((current) =>
      current && nextWorkbenchState.remote.entries.some((entry) => entry.path === current) ? current : null,
    );
    setBrowserPaneErrors({ local: null, remote: null });
    setActiveConnection(nextConnection);
    setLocalTerminalDirectory((current) => current || nextLocalDirectory);
    setRemoteTerminalDirectory((current) => current || nextRemoteDirectory);
    setConnectionResult(nextConnectionResult);
    setIsRemoteBrowserConnected(true);
    storeWorkbenchSnapshot(
      nextConnection,
      nextWorkbenchState,
      nextConnectionResult,
      nextLocalDirectory,
      nextRemoteDirectory,
      true,
      terminalSnapshot,
    );
  };

  const applyWorkbenchShell = (
    connection: ConnectionDraft,
    result: Awaited<ReturnType<typeof browseLocalDirectory>>,
    nextConnectionResult: ConnectionTestResult | null,
    terminalSnapshot?: Partial<
      Pick<
        WorkbenchSnapshot,
        | 'terminalScope'
        | 'terminalSessionId'
        | 'terminalSessionScope'
        | 'terminalHistory'
        | 'remoteTerminalHistory'
        | 'terminalOutput'
        | 'terminalDebugEntries'
      >
    >,
    cacheShowHidden = showHiddenFiles,
  ) => {
    const nextConnection = {
      ...connection,
      path: normalizeConnectionPath(connection.path),
    };
    const nextWorkbenchState: WorkbenchState = {
      local: result.data,
      remote: createRemoteBrowserPlaceholder(nextConnection),
      runtimeMode: result.runtimeMode,
    };
    const nextLocalDirectory = nextWorkbenchState.local.directory;
    const nextRemoteDirectory = nextWorkbenchState.remote.directory;

    rememberBrowseCache(nextConnection, 'local', nextLocalDirectory, cacheShowHidden, {
      data: nextWorkbenchState.local,
      runtimeMode: result.runtimeMode,
    });

    setRuntimeMode(result.runtimeMode);
    setWorkbenchState(nextWorkbenchState);
    setSelectedLocalPaths([]);
    setSelectedRemotePaths([]);
    setSelectedLocalPath(null);
    setSelectedRemotePath(null);
    setBrowserPaneErrors({ local: null, remote: null });
    setActiveConnection(nextConnection);
    setLocalTerminalDirectory((current) => current || nextLocalDirectory);
    setRemoteTerminalDirectory((current) => current || nextRemoteDirectory);
    setConnectionResult(nextConnectionResult);
    setIsRemoteBrowserConnected(false);
    storeWorkbenchSnapshot(
      nextConnection,
      nextWorkbenchState,
      nextConnectionResult,
      nextLocalDirectory,
      nextRemoteDirectory,
      false,
      terminalSnapshot,
    );
  };

  const refreshWorkbenchView = async (
    connection: ConnectionDraft,
    paths?: {
      localPath?: string;
      remotePath?: string;
      showHidden?: boolean;
    },
  ) => {
    const nextShowHidden = paths?.showHidden ?? showHiddenFiles;
    if (isRemoteBrowserConnected) {
      const refreshed = await loadWorkbench(connection, {
        localPath: paths?.localPath ?? workbenchState?.local.directory,
        remotePath: paths?.remotePath ?? workbenchState?.remote.directory ?? connection.path,
        showHidden: nextShowHidden,
      });
      applyWorkbenchData(connection, refreshed, undefined, nextShowHidden);
      return;
    }

    const refreshedLocal = await browseLocalDirectory(
      paths?.localPath ?? workbenchState?.local.directory,
      nextShowHidden,
    );
    const nextConnectionResult =
      activeConnection && connectionResult?.connected && sameConnectionEndpoint(activeConnection, connection)
        ? connectionResult
        : null;
    applyWorkbenchShell(connection, refreshedLocal, nextConnectionResult, undefined, nextShowHidden);
  };

  const selectDraft = (nextDraft: ConnectionDraft, message: string) => {
    updateDraft(nextDraft);
    setNotice({
      tone: 'info',
      title: message,
      detail: '现在可以测试连接，或者直接载入当前工作台。',
    });
  };

  const handleNewConnectionDraft = () => {
    updateDraft({
      ...emptyDraft,
      port: '22',
    });
    setNotice({
      tone: 'info',
      title: '新建连接配置',
      detail: '填写右侧表单后可以保存为主机配置。',
    });
  };

  const handleSelectFavoriteInDialog = async (favorite: FavoriteItem) => {
    const hydratedFavorite = await hydrateFavoritePassword(
      favorite,
      hydrateConnectionDraft(toDraftFromFavorite(favorite)),
    );
    selectDraft(hydratedFavorite, `正在编辑 ${favorite.name}`);
  };

  const testConnectionWithLegacyFallback = async (connection: ConnectionDraft) => {
    try {
      return {
        connection,
        result: await testConnection(connection),
        enabledLegacy: false,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!isSshConnection(connection) || connection.legacySshHostKeyAlgorithms || !isLegacySshCompatibilityError(detail)) {
        throw error;
      }

      const legacyConnection = withLegacySshCompatibility(connection);
      return {
        connection: legacyConnection,
        result: await testConnection(legacyConnection),
        enabledLegacy: true,
      };
    }
  };

  const handleTestConnection = async () => {
    if (!canSubmitConnection) {
      setNotice({
        tone: 'error',
        title: '还缺少主机地址',
        detail: '先填写主机，或者从最近使用中带入一个连接。',
      });
      return;
    }

    if (activeConnection && connectionResult?.connected && sameConnectionEndpoint(activeConnection, draft)) {
      const workingDirectory = workbenchState?.remote.directory ?? activeConnection.path;
      const cachedResult = {
        protocol: draft.protocol,
        endpoint: draft.host.trim(),
        connected: true,
        workingDirectory,
        remotePath: workingDirectory,
      };
      setConnectionResult(cachedResult);
      setNotice({
        tone: 'success',
        title: '已复用当前连接',
        detail: `当前会话仍然可用 · ${workingDirectory}`,
      });
      return;
    }

    setIsTesting(true);
    setNotice(null);

    try {
      const { connection: testedConnection, result, enabledLegacy } = await testConnectionWithLegacyFallback(draft);
      if (enabledLegacy) {
        setDraft(testedConnection);
      }
      rememberConnectionCredentials(testedConnection);
      persistFavoritePasswordIfNeeded(testedConnection);
      setRuntimeMode(result.runtimeMode);
      setConnectionResult(result.data);
      rememberConnection(testedConnection, result.data.remotePath ?? result.data.workingDirectory);
      setNotice({
        tone: 'success',
        title: enabledLegacy
          ? '已自动启用旧 SSH 兼容'
          : result.runtimeMode === 'live'
            ? `已连接到 ${result.data.endpoint}`
            : '预览模式下已模拟连接检测',
        detail:
          enabledLegacy
            ? `检测到旧服务器只提供 ssh-rsa/ssh-dss，已重试成功。工作目录：${result.data.workingDirectory}`
            : result.runtimeMode === 'live'
            ? `工作目录：${result.data.workingDirectory}`
            : '在 Tauri 桌面窗口中，这里会执行真实连接检测。',
      });
    } catch (error) {
      setConnectionResult(null);
      setNotice({
        tone: 'error',
        title: '连接失败',
        detail: error instanceof Error ? error.message : '无法完成连接测试。',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const openWorkbenchWithConnection = async (
    connection: ConnectionDraft,
    options?: {
      openingId?: string;
      missingConnectionDetail?: string;
      reopenDialogOnError?: boolean;
      connectRemoteBrowser?: boolean;
    },
  ) => {
    if (!connection.host.trim()) {
      setNotice({
        tone: 'error',
        title: '还不能进入工作台',
        detail: options?.missingConnectionDetail ?? '先填写主机，或者从最近使用与收藏中选择一个连接。',
      });
      return;
    }

    setDraft(connection);
    persistActiveWorkbenchSnapshot();
    autoRemoteTerminalKeyRef.current = null;
    flushSync(() => {
      setIsConnectionDialogOpen(false);
      setIsOpeningWorkbench(true);
      setOpeningConnectionId(options?.openingId ?? null);
      setIsRefreshingLocal(true);
      setIsRefreshingRemote(Boolean(options?.connectRemoteBrowser));
      setLocalTerminalDirectory('');
      setRemoteTerminalDirectory('');
      setBrowserPaneErrors({ local: null, remote: null });
      setNotice(null);
    });

    let hasPreparedLocalWorkbench = false;

    try {
      const localResult = await browseLocalDirectory(undefined, showHiddenFiles);
      rememberConnectionCredentials(connection);
      persistFavoritePasswordIfNeeded(connection);
      const nextConnectionResult =
        activeConnection && connectionResult?.connected && sameConnectionEndpoint(activeConnection, connection)
          ? {
              ...connectionResult,
              protocol: connection.protocol,
              endpoint: connection.host.trim(),
            }
          : null;
      const matchingFavoriteId = resolveSavedFavoriteId(favoriteConnections, connection);
      const targetSnapshot = matchingFavoriteId
        ? workbenchSnapshotsRef.current[matchingFavoriteId]
        : null;
      const targetLiveSession = matchingFavoriteId
        ? favoriteTerminalSessionsRef.current[matchingFavoriteId] ?? null
        : null;
      const targetTerminalSnapshot = {
        terminalScope: 'remote' as TerminalScope,
        terminalSessionId: supportsRemoteTerminal(connection)
          ? targetLiveSession?.sessionId ?? targetSnapshot?.terminalSessionId ?? null
          : null,
        terminalSessionScope: supportsRemoteTerminal(connection)
          ? targetLiveSession?.scope ?? targetSnapshot?.terminalSessionScope ?? ('remote' as TerminalScope)
          : null,
        terminalHistory: targetSnapshot?.terminalHistory ?? [],
        remoteTerminalHistory: targetSnapshot?.remoteTerminalHistory ?? [],
        terminalOutput: targetSnapshot?.terminalOutput ?? '',
        terminalDebugEntries: targetSnapshot?.terminalDebugEntries ?? [],
      };

      if (options?.connectRemoteBrowser) {
        applyWorkbenchShell(connection, localResult, nextConnectionResult, targetTerminalSnapshot);
        restoreTerminalStateForFavorite(matchingFavoriteId, connection, targetSnapshot);
        setIsRefreshingLocal(false);
        hasPreparedLocalWorkbench = true;

        let remoteConnection = connection;
        let enabledLegacy = false;
        let remoteResult: Awaited<ReturnType<typeof browseRemoteDirectory>>;

        try {
          remoteResult = await browseRemoteDirectory(remoteConnection, remoteConnection.path, showHiddenFiles);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (
            !isSshConnection(remoteConnection) ||
            remoteConnection.legacySshHostKeyAlgorithms ||
            !isLegacySshCompatibilityError(detail)
          ) {
            throw error;
          }

          remoteConnection = withLegacySshCompatibility(remoteConnection);
          enabledLegacy = true;
          remoteResult = await browseRemoteDirectory(remoteConnection, remoteConnection.path, showHiddenFiles);
        }

        const combinedResult: Awaited<ReturnType<typeof loadWorkbench>> = {
          data: {
            local: localResult.data,
            remote: remoteResult.data,
          },
          runtimeMode: remoteResult.runtimeMode,
        };
        const openedConnection = {
          ...remoteConnection,
          path: remoteResult.data.directory,
        };

        if (enabledLegacy) {
          setDraft(openedConnection);
        }

        startTransition(() => {
          applyWorkbenchData(openedConnection, combinedResult, targetTerminalSnapshot);
          restoreTerminalStateForFavorite(matchingFavoriteId, openedConnection, targetSnapshot);
          setNotice({
            tone: 'success',
            title: enabledLegacy ? '已自动启用旧 SSH 兼容' : '远端文件区已连接',
            detail: enabledLegacy
              ? `检测到旧服务器只提供 ssh-rsa/ssh-dss，已重试并载入：${remoteResult.data.directory}`
              : remoteResult.data.directory,
          });
        });
        rememberConnection(openedConnection, remoteResult.data.directory);
        return;
      }

      startTransition(() => {
        applyWorkbenchShell(connection, localResult, nextConnectionResult, targetTerminalSnapshot);
        restoreTerminalStateForFavorite(matchingFavoriteId, connection, targetSnapshot);
        setNotice({
          tone: 'info',
          title: localResult.runtimeMode === 'live' ? '工作台已准备好' : '预览工作台已准备好',
          detail:
            localResult.runtimeMode === 'live'
              ? '默认先准备本地文件区和远端终端；远端文件浏览改为按需连接。'
              : '当前浏览器预览会展示模拟列表，桌面窗口里会按需连接远端目录。',
        });
      });
      rememberConnection(connection, normalizeConnectionPath(connection.path));
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未能完成目录载入。';
      const connectionFailureNotice = describeConnectionFailure(detail);
      if (options?.connectRemoteBrowser && hasPreparedLocalWorkbench) {
        setBrowserPaneError('remote', normalizeConnectionPath(connection.path), detail);
      }
      setNotice(connectionFailureNotice);
      if (options?.reopenDialogOnError) {
        openConnectionDialogWithDraft(connection, connectionFailureNotice);
      }
    } finally {
      setIsRefreshingLocal(false);
      setIsRefreshingRemote(false);
      setIsOpeningWorkbench(false);
      setOpeningConnectionId(null);
    }
  };

  const handleOpenWorkbench = async () => {
    await openWorkbenchWithConnection(draft, {
      missingConnectionDetail: '先填写主机，或者从最近使用与收藏中选择一个连接。',
    });
  };

  const handleOpenSession = async (session: SessionItem) => {
    const connection = hydrateConnectionDraft(toDraft(session));
    if (needsConnectionDialog(connection)) {
      openConnectionDialogWithDraft(connection, {
        tone: 'info',
        title: '已带入最近连接',
        detail: '当前没有可复用的登录信息，已带入连接面板，请确认用户名和密码后再连接。',
      });
      return;
    }

    await openWorkbenchWithConnection(connection, {
      openingId: `recent:${session.id}`,
      reopenDialogOnError: true,
    });
  };

  const handleOpenFavorite = async (favorite: FavoriteItem) => {
    setSelectedFavoriteId(favorite.id);
    setNotice(null);
    setBrowserPaneErrors({ local: null, remote: null });
    const connection = await hydrateFavoritePassword(
      favorite,
      hydrateConnectionDraft(toDraftFromFavorite(favorite)),
    );
    if (needsConnectionDialog(connection)) {
      openConnectionDialogWithDraft(connection, {
        tone: 'info',
        title: `已带入收藏 ${favorite.name}`,
        detail: '当前没有可复用的登录信息，已带入连接面板，请确认用户名和密码后再连接。',
      });
      return;
    }

    await openWorkbenchWithConnection(connection, {
      openingId: `favorite:${favorite.id}`,
      reopenDialogOnError: true,
      connectRemoteBrowser: true,
    });
  };

  const handleSaveFavoriteDirectory = async (favorite: FavoriteItem) => {
    const favoriteConnection = hydrateConnectionDraft(toDraftFromFavorite(favorite));
    if (!activeConnection || !sameConnectionEndpoint(activeConnection, favoriteConnection)) {
      setNotice({
        tone: 'info',
        title: '还没有当前目录',
        detail: '先连接并进入这个主机的文件浏览区，再把当前远端目录保存到目录列表。',
      });
      return;
    }

    const currentDirectory = normalizeConnectionPath(workbenchState?.remote.directory || activeConnection.path || favorite.path);
    const nextConnection: ConnectionDraft = {
      ...favoriteConnection,
      path: normalizeConnectionPath(favorite.path),
      paths: normalizeConnectionPaths([favorite.path, ...(favorite.paths ?? []), currentDirectory]),
    };

    setIsSavingFavorite(true);
    try {
      const result = await saveFavorite(nextConnection, favorite.name);
      setHasLoadedFavorites(true);
      rememberFavoriteCredentials(result.data);
      setFavoriteConnections((current) => preserveFavoriteTabOrder(current, result.data));
      setSelectedFavoriteId(resolveSavedFavoriteId(result.data, nextConnection));
      setNotice({
        tone: 'success',
        title: '目录已保存',
        detail: currentDirectory,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: '保存目录失败',
        detail: error instanceof Error ? error.message : '未能把当前目录加入配置。',
      });
    } finally {
      setIsSavingFavorite(false);
    }
  };

  const handleOpenFavoriteDirectory = async (favorite: FavoriteItem, path: string) => {
    setSelectedFavoriteId(favorite.id);
    setNotice(null);
    setBrowserPaneErrors({ local: null, remote: null });
    const normalizedPath = normalizeConnectionPath(path);
    const connection = await hydrateFavoritePassword(
      favorite,
      withConnectionDirectory(hydrateConnectionDraft(toDraftFromFavorite(favorite)), normalizedPath),
    );

    if (needsConnectionDialog(connection)) {
      openConnectionDialogWithDraft(connection, {
        tone: 'info',
        title: `已选择目录 ${normalizedPath}`,
        detail: '当前没有可复用的登录信息，请确认用户名和密码后再进入。',
      });
      return;
    }

    if (
      activeConnection &&
      workbenchState &&
      isRemoteBrowserConnected &&
      sameConnectionEndpoint(activeConnection, connection)
    ) {
      await handleNavigateWorkbench('remote', normalizedPath);
      return;
    }

    await openWorkbenchWithConnection(connection, {
      openingId: `favorite:${favorite.id}`,
      reopenDialogOnError: true,
      connectRemoteBrowser: true,
    });
  };

  const handleRefreshWorkbench = async () => {
    if (!activeConnection) {
      setNotice({
        tone: 'info',
        title: '先连接远端',
        detail: '打开连接面板后，再刷新目录。',
      });
      setIsConnectionDialogOpen(true);
      return;
    }

    setIsRefreshingWorkbench(true);
    setIsRefreshingLocal(true);
    setIsRefreshingRemote(isRemoteBrowserConnected);
    setBrowserPaneErrors({ local: null, remote: null });
    clearBrowseCache();
    try {
      await refreshWorkbenchView(activeConnection);
      setNotice({
        tone: 'success',
        title: '工作台已刷新',
        detail: isRemoteBrowserConnected
          ? `当前目录：${workbenchState?.remote.directory ?? activeConnection.path}`
          : `本地目录：${workbenchState?.local.directory ?? '/tmp/rterm-demo'}`,
      });
    } catch (error) {
      if (isRemoteBrowserConnected) {
        setBrowserPaneError(
          'remote',
          workbenchState?.remote.directory ?? activeConnection.path,
          error instanceof Error ? error.message : '未能完成目录刷新。',
        );
      } else {
        setBrowserPaneError(
          'local',
        workbenchState?.local.directory ?? '/tmp/rterm-demo',
          error instanceof Error ? error.message : '未能完成目录刷新。',
        );
      }
      setNotice({
        tone: 'error',
        title: '刷新失败',
        detail: error instanceof Error ? error.message : '未能完成目录刷新。',
      });
    } finally {
      setIsRefreshingLocal(false);
      if (isRemoteBrowserConnected) {
        setIsRefreshingRemote(false);
      }
      setIsRefreshingWorkbench(false);
    }
  };

  const handleRefreshLocalDirectory = async () => {
    if (!activeConnection || !workbenchState || isRefreshingLocal) {
      return;
    }

    setIsRefreshingLocal(true);
    clearBrowseCache();
    clearBrowserPaneError('local');
    try {
      const result = await browseLocalDirectory(workbenchState.local.directory, showHiddenFiles);
      applyBrowseNavigationResult('local', result, activeConnection, workbenchState);
      setNotice({
        tone: 'success',
        title: '本地目录已刷新',
        detail: result.data.directory,
      });
    } catch (error) {
      setBrowserPaneError(
        'local',
        workbenchState.local.directory,
        error instanceof Error ? error.message : '未能刷新本地目录。',
      );
      setNotice({
        tone: 'error',
        title: '本地目录刷新失败',
        detail: error instanceof Error ? error.message : '未能刷新本地目录。',
      });
    } finally {
      setIsRefreshingLocal(false);
    }
  };

  const handleRefreshRemoteDirectory = async () => {
    if (!activeConnection || !workbenchState || isRefreshingRemote) {
      return;
    }

    if (!isRemoteBrowserConnected) {
      setNotice({
        tone: 'info',
        title: '远端文件区还没有连接',
        detail: '先点远端面板里的链路图标，再刷新远端目录。',
      });
      return;
    }

    setIsRefreshingRemote(true);
    clearBrowseCache();
    clearBrowserPaneError('remote');
    try {
      let remoteConnection = activeConnection;
      let enabledLegacy = false;
      const targetPath = workbenchState.remote.directory || remoteConnection.path;
      let result;
      try {
        result = await browseRemoteDirectory(
          remoteConnection,
          targetPath,
          showHiddenFiles,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (
          !isSshConnection(remoteConnection) ||
          remoteConnection.legacySshHostKeyAlgorithms ||
          !isLegacySshCompatibilityError(detail)
        ) {
          throw error;
        }

        remoteConnection = withLegacySshCompatibility(remoteConnection);
        enabledLegacy = true;
        result = await browseRemoteDirectory(
          remoteConnection,
          targetPath,
          showHiddenFiles,
        );
      }
      applyBrowseNavigationResult('remote', result, remoteConnection, workbenchState);
      setIsRemoteBrowserConnected(true);
      setNotice({
        tone: 'success',
        title: enabledLegacy ? '已自动启用旧 SSH 兼容' : '远端目录已刷新',
        detail: result.data.directory,
      });
    } catch (error) {
      setBrowserPaneError(
        'remote',
        workbenchState.remote.directory || activeConnection.path,
        error instanceof Error ? error.message : '未能刷新远端目录。',
      );
      setNotice({
        tone: 'error',
        title: '远端目录刷新失败',
        detail: error instanceof Error ? error.message : '未能刷新远端目录。',
      });
    } finally {
      setIsRefreshingRemote(false);
    }
  };

  const applyBrowseNavigationResult = (
    scope: FileMutationScope,
    result: BrowseRuntimeResult,
    connection: ConnectionDraft,
    state: WorkbenchState,
  ) => {
    const nextWorkbenchState =
      scope === 'local'
        ? {
            ...state,
            local: result.data,
            runtimeMode: result.runtimeMode,
          }
        : {
            ...state,
            remote: result.data,
            runtimeMode: result.runtimeMode,
          };
    const nextConnection =
      scope === 'remote'
        ? {
            ...connection,
            path: result.data.directory,
          }
        : connection;
    const nextConnectionResult =
      scope === 'remote'
        ? connectionResult
          ? {
              ...connectionResult,
              connected: true,
              workingDirectory: result.data.directory,
              remotePath: result.data.directory,
            }
          : {
              protocol: nextConnection.protocol,
              endpoint: nextConnection.host.trim(),
              connected: true,
              workingDirectory: result.data.directory,
              remotePath: result.data.directory,
            }
        : connectionResult;

    rememberBrowseCache(nextConnection, scope, result.data.directory, showHiddenFiles, result);
    setRuntimeMode(result.runtimeMode);
    setWorkbenchState(nextWorkbenchState);
    setActiveConnection(nextConnection);
    clearBrowserPaneError(scope);
    if (scope === 'local') {
      setLocalTerminalDirectory(result.data.directory);
    } else {
      setRemoteTerminalDirectory(result.data.directory);
    }
    if (nextConnectionResult) {
      setConnectionResult(nextConnectionResult);
    }
    storeWorkbenchSnapshot(
      nextConnection,
      nextWorkbenchState,
      nextConnectionResult ?? null,
      scope === 'local' ? result.data.directory : localTerminalDirectory || nextWorkbenchState.local.directory,
      scope === 'remote' ? result.data.directory : remoteTerminalDirectory || nextWorkbenchState.remote.directory,
      isRemoteBrowserConnected || scope === 'remote',
    );
  };

  const handleNavigateWorkbench = async (scope: 'local' | 'remote', path: string) => {
    if (!activeConnection || !workbenchState) {
      return;
    }

    if (scope === 'remote' && !isRemoteBrowserConnected) {
      setNotice({
        tone: 'info',
        title: '远端文件区还没有连接',
        detail: '先点远端面板里的链路图标，再浏览远端目录。',
      });
      return;
    }

    const currentDirectory =
      scope === 'local' ? workbenchState?.local.directory : workbenchState?.remote.directory;
    const navigationKey = `${scope}:${path}`;

    if (path === currentDirectory || navigationKeyRef.current === navigationKey) {
      return;
    }

    navigationKeyRef.current = navigationKey;

    if (scope === 'local') {
      setSelectedLocalPaths([]);
      setSelectedLocalPath(null);
    } else {
      setSelectedRemotePaths([]);
      setSelectedRemotePath(null);
    }

    const currentListing = scope === 'local' ? workbenchState.local : workbenchState.remote;
    rememberBrowseCache(activeConnection, scope, currentDirectory, showHiddenFiles, {
      data: currentListing,
      runtimeMode: workbenchState.runtimeMode,
    });

    const cachedResult = readBrowseCache(activeConnection, scope, path, showHiddenFiles);
    if (cachedResult) {
      applyBrowseNavigationResult(scope, cachedResult, activeConnection, workbenchState);
      navigationKeyRef.current = null;
      return;
    }

    const requestId = browseRequestSequenceRef.current + 1;
    browseRequestSequenceRef.current = requestId;
    if (scope === 'local') {
      setIsRefreshingLocal(true);
    } else {
      setIsRefreshingRemote(true);
    }
    clearBrowserPaneError(scope);
    try {
      const result =
        scope === 'local'
          ? await browseLocalDirectory(path, showHiddenFiles)
          : await browseRemoteDirectory(activeConnection, path, showHiddenFiles);

      if (browseRequestSequenceRef.current !== requestId) {
        return;
      }

      applyBrowseNavigationResult(scope, result, activeConnection, workbenchState);
      setNotice({
        tone: 'success',
        title: scope === 'local' ? '已切换本地目录' : '已切换远端目录',
        detail: path,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: scope === 'local' ? '本地目录切换失败' : '远端目录切换失败',
        detail: error instanceof Error ? error.message : '未能切换目录。',
      });
      setBrowserPaneError(scope, path, error instanceof Error ? error.message : '未能切换目录。');
    } finally {
      navigationKeyRef.current = null;
      if (scope === 'local') {
        setIsRefreshingLocal(false);
      } else {
        setIsRefreshingRemote(false);
      }
    }
  };

  const handleConnectRemoteBrowser = async () => {
    if (!activeConnection || isRefreshingRemote || isOpeningWorkbench) {
      return;
    }

    if (!workbenchState) {
      const selectedFavorite = selectedFavoriteId
        ? favoriteConnections.find((favorite) => favorite.id === selectedFavoriteId) ?? null
        : null;
      if (selectedFavorite) {
        await handleOpenFavoriteDirectory(selectedFavorite, activeConnection.path || selectedFavorite.path);
        return;
      }

      await openWorkbenchWithConnection(activeConnection, {
        reopenDialogOnError: true,
        connectRemoteBrowser: true,
      });
      return;
    }

    setIsRefreshingRemote(true);
    clearBrowserPaneError('remote');
    try {
      let remoteConnection = activeConnection;
      let enabledLegacy = false;
      let result;
      try {
        result = await browseRemoteDirectory(
          remoteConnection,
          workbenchState.remote.directory || remoteConnection.path,
          showHiddenFiles,
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (
          !isSshConnection(remoteConnection) ||
          remoteConnection.legacySshHostKeyAlgorithms ||
          !isLegacySshCompatibilityError(detail)
        ) {
          throw error;
        }

        remoteConnection = withLegacySshCompatibility(remoteConnection);
        enabledLegacy = true;
        result = await browseRemoteDirectory(
          remoteConnection,
          workbenchState.remote.directory || remoteConnection.path,
          showHiddenFiles,
        );
      }
      const nextWorkbenchState: WorkbenchState = {
        ...workbenchState,
        remote: result.data,
        runtimeMode: result.runtimeMode,
      };
      const nextConnection: ConnectionDraft = {
        ...remoteConnection,
        path: result.data.directory,
      };
      const nextConnectionResult: ConnectionTestResult =
        connectionResult && sameConnectionEndpoint(activeConnection, nextConnection)
          ? {
              ...connectionResult,
              connected: true,
              workingDirectory: result.data.directory,
              remotePath: result.data.directory,
            }
          : {
              protocol: nextConnection.protocol,
              endpoint: nextConnection.host.trim(),
              connected: true,
              workingDirectory: result.data.directory,
              remotePath: result.data.directory,
            };

      setRuntimeMode(result.runtimeMode);
      setWorkbenchState(nextWorkbenchState);
      setActiveConnection(nextConnection);
      clearBrowserPaneError('remote');
      setRemoteTerminalDirectory((current) => current || result.data.directory);
      setConnectionResult(nextConnectionResult);
      setIsRemoteBrowserConnected(true);
      storeWorkbenchSnapshot(
        nextConnection,
        nextWorkbenchState,
        nextConnectionResult,
        localTerminalDirectory || nextWorkbenchState.local.directory,
        remoteTerminalDirectory || result.data.directory,
        true,
      );
      setNotice({
        tone: 'success',
        title: enabledLegacy ? '已自动启用旧 SSH 兼容' : '远端文件区已连接',
        detail: enabledLegacy
          ? `检测到旧服务器只提供 ssh-rsa/ssh-dss，已重试并载入：${result.data.directory}`
          : result.data.directory,
      });
    } catch (error) {
      setBrowserPaneError(
        'remote',
        activeConnection.path,
        error instanceof Error ? error.message : '未能连接远端文件区。',
      );
      setNotice({
        tone: 'error',
        title: '远端目录连接失败',
        detail: error instanceof Error ? error.message : '未能连接远端文件区。',
      });
    } finally {
      setIsRefreshingRemote(false);
    }
  };

  const handleDisconnectRemoteBrowser = () => {
    if (!activeConnection || !workbenchState) {
      return;
    }

    const nextConnection = {
      ...activeConnection,
      path: workbenchState.remote.directory || activeConnection.path,
    };
    const nextWorkbenchState: WorkbenchState = {
      ...workbenchState,
      remote: createRemoteBrowserPlaceholder(nextConnection),
    };

    setSelectedRemotePaths([]);
    setSelectedRemotePath(null);
    setWorkbenchState(nextWorkbenchState);
    setActiveConnection(nextConnection);
    setConnectionResult(null);
    clearBrowserPaneError('remote');
    setIsRemoteBrowserConnected(false);
    storeWorkbenchSnapshot(
      nextConnection,
      nextWorkbenchState,
      null,
      localTerminalDirectory || nextWorkbenchState.local.directory,
      remoteTerminalDirectory || nextWorkbenchState.remote.directory,
      false,
    );
    setNotice({
      tone: 'info',
      title: '远端文件区已断开',
      detail: '终端和已保存配置不受影响，需要时再点链路图标连接。',
    });
  };

  const handleSelectWorkbenchEntry = (
    scope: 'local' | 'remote',
    entry: BrowseEntry,
    options?: { toggle?: boolean; range?: boolean; rangePaths?: string[] },
  ) => {
    const toggle = options?.toggle ?? false;
    const range = options?.range ?? false;

    if (scope === 'local') {
      if (range) {
        const rangePaths =
          options?.rangePaths ??
          selectEntryPathRange(
            workbenchState?.local.entries ?? [],
            selectedLocalPath ?? selectedLocalPaths[selectedLocalPaths.length - 1] ?? null,
            entry.path,
          );
        setSelectedLocalPaths((current) => (toggle ? uniquePaths([...current, ...rangePaths]) : rangePaths));
        setSelectedLocalPath(entry.path);
        return;
      }

      if (toggle) {
        setSelectedLocalPaths((current) => {
          const exists = current.includes(entry.path);
          const next = exists ? current.filter((path) => path !== entry.path) : [...current, entry.path];
          setSelectedLocalPath(next.length === 0 ? null : exists ? next[next.length - 1] ?? null : entry.path);
          return next;
        });
        return;
      }

      setSelectedLocalPaths([entry.path]);
      setSelectedLocalPath(entry.path);
      return;
    }

    if (range) {
      const rangePaths =
        options?.rangePaths ??
        selectEntryPathRange(
          workbenchState?.remote.entries ?? [],
          selectedRemotePath ?? selectedRemotePaths[selectedRemotePaths.length - 1] ?? null,
          entry.path,
        );
      setSelectedRemotePaths((current) => (toggle ? uniquePaths([...current, ...rangePaths]) : rangePaths));
      setSelectedRemotePath(entry.path);
      return;
    }

    if (toggle) {
      setSelectedRemotePaths((current) => {
        const exists = current.includes(entry.path);
        const next = exists ? current.filter((path) => path !== entry.path) : [...current, entry.path];
        setSelectedRemotePath(next.length === 0 ? null : exists ? next[next.length - 1] ?? null : entry.path);
        return next;
      });
      return;
    }

    setSelectedRemotePaths([entry.path]);
    setSelectedRemotePath(entry.path);
  };

  const handleToggleShowHidden = async () => {
    const nextShowHidden = !showHiddenFiles;
    clearBrowseCache();
    setShowHiddenFiles(nextShowHidden);

    if (!activeConnection || !workbenchState) {
      return;
    }

    setIsRefreshingWorkbench(true);
    setIsRefreshingLocal(true);
    setIsRefreshingRemote(isRemoteBrowserConnected);
    setBrowserPaneErrors({ local: null, remote: null });
    try {
      await refreshWorkbenchView(activeConnection, {
        localPath: workbenchState.local.directory,
        remotePath: workbenchState.remote.directory ?? activeConnection.path,
        showHidden: nextShowHidden,
      });
      setNotice({
        tone: 'success',
        title: nextShowHidden ? '已显示隐藏文件' : '已隐藏点文件',
      });
    } catch (error) {
      setShowHiddenFiles(showHiddenFiles);
      if (isRemoteBrowserConnected) {
        setBrowserPaneError(
          'remote',
          workbenchState.remote.directory ?? activeConnection.path,
          error instanceof Error ? error.message : '未能更新目录显示。',
        );
      } else {
        setBrowserPaneError(
          'local',
          workbenchState.local.directory,
          error instanceof Error ? error.message : '未能更新目录显示。',
        );
      }
      setNotice({
        tone: 'error',
        title: '隐藏文件切换失败',
        detail: error instanceof Error ? error.message : '未能更新目录显示。',
      });
    } finally {
      setIsRefreshingLocal(false);
      if (isRemoteBrowserConnected) {
        setIsRefreshingRemote(false);
      }
      setIsRefreshingWorkbench(false);
    }
  };

  const openSearchDialog = (
    scope: FileMutationScope,
    directoryOverride?: string | null,
    targets: BrowseEntry[] = [],
    mode: SearchMode = 'content',
  ) => {
    const directory =
      directoryOverride ?? (scope === 'local' ? workbenchState?.local.directory : workbenchState?.remote.directory);
    if (!directory) {
      return;
    }

    openSearch(scope, directory, targets, mode);
  };

  const handleRevealSearchEntry = async (entry: BrowseEntry, displayPath?: string | null) => {
    if (!pendingSearch || !activeConnection) {
      return;
    }

    const scope = pendingSearch.scope;
    const targetDirectory = entry.kind === 'directory' ? entry.path : parentDirectoryOfPath(entry.path);
    if (!targetDirectory) {
      return;
    }

    clearSearch();

    await handleNavigateWorkbench(scope, targetDirectory);
    if (entry.kind === 'file') {
      if (scope === 'local') {
        setSelectedLocalPaths([entry.path]);
        setSelectedLocalPath(entry.path);
      } else {
        setSelectedRemotePaths([entry.path]);
        setSelectedRemotePath(entry.path);
      }
    }
    setNotice({
      tone: 'success',
      title: scope === 'local' ? '已定位本地搜索结果' : '已定位远端搜索结果',
      detail: displayPath ?? entry.path,
    });
  };

  const openCreateDirectoryDialog = (scope: FileMutationScope) => {
    const directory = scope === 'local' ? workbenchState?.local.directory : workbenchState?.remote.directory;
    if (!directory) {
      return;
    }

    setFileMutationValue('');
    setPendingFileMutation({
      action: 'create-directory',
      scope,
      directory,
      name: '',
    });
  };

  const openRenameEntryDialog = (
    scope: FileMutationScope,
    targetEntry?: BrowseEntry | null,
  ) => {
    const entry =
      targetEntry ?? (scope === 'local' ? selectedLocalEntry : selectedRemoteEntry);
    const directory = scope === 'local' ? workbenchState?.local.directory : workbenchState?.remote.directory;
    if (!entry || !directory) {
      return;
    }

    setFileMutationValue(entry.name);
    setPendingFileMutation({
      action: 'rename',
      scope,
      directory,
      path: entry.path,
      entryKind: entry.kind,
      name: entry.name,
    });
  };

  const openCopyEntryDialog = (
    scope: FileMutationScope,
    targetEntry?: BrowseEntry | null,
  ) => {
    const selectedEntries = scope === 'local' ? selectedLocalEntries : selectedRemoteEntries;
    const entry =
      targetEntry ?? (selectedEntries.length === 1 ? selectedEntries[0] : scope === 'local' ? selectedLocalEntry : selectedRemoteEntry);
    const directory = scope === 'local' ? workbenchState?.local.directory : workbenchState?.remote.directory;
    if ((!entry && selectedEntries.length === 0) || !directory) {
      return;
    }

    if (!targetEntry && selectedEntries.length > 1) {
      setFileMutationValue(directory);
      setPendingFileMutation({
        action: 'copy',
        scope,
        directory,
        paths: selectedEntries.map((item) => item.path),
        name: `已选 ${selectedEntries.length} 项`,
      });
      return;
    }

    if (!entry) {
      return;
    }

    setFileMutationValue(suggestCopyDestination(entry));
    setPendingFileMutation({
      action: 'copy',
      scope,
      directory,
      path: entry.path,
      entryKind: entry.kind,
      name: entry.name,
    });
  };

  const openMoveEntryDialog = (
    scope: FileMutationScope,
    targetEntry?: BrowseEntry | null,
  ) => {
    const selectedEntries = scope === 'local' ? selectedLocalEntries : selectedRemoteEntries;
    const entry =
      targetEntry ?? (selectedEntries.length === 1 ? selectedEntries[0] : scope === 'local' ? selectedLocalEntry : selectedRemoteEntry);
    const directory = scope === 'local' ? workbenchState?.local.directory : workbenchState?.remote.directory;
    if ((!entry && selectedEntries.length === 0) || !directory) {
      return;
    }

    if (!targetEntry && selectedEntries.length > 1) {
      setFileMutationValue(directory);
      setPendingFileMutation({
        action: 'move',
        scope,
        directory,
        paths: selectedEntries.map((item) => item.path),
        name: `已选 ${selectedEntries.length} 项`,
      });
      return;
    }

    if (!entry) {
      return;
    }

    setFileMutationValue(entry.path);
    setPendingFileMutation({
      action: 'move',
      scope,
      directory,
      path: entry.path,
      entryKind: entry.kind,
      name: entry.name,
    });
  };

  const openChmodEntryDialog = (
    scope: FileMutationScope,
    targetEntry?: BrowseEntry | null,
  ) => {
    const selectedEntries = scope === 'local' ? selectedLocalEntries : selectedRemoteEntries;
    const entry =
      targetEntry ?? (selectedEntries.length === 1 ? selectedEntries[0] : scope === 'local' ? selectedLocalEntry : selectedRemoteEntry);
    const directory = scope === 'local' ? workbenchState?.local.directory : workbenchState?.remote.directory;
    if ((!entry && selectedEntries.length === 0) || !directory) {
      return;
    }

    if (!targetEntry && selectedEntries.length > 1) {
      const firstEntry = selectedEntries[0];
      setFileMutationValue(firstEntry?.permissions?.trim() || '755');
      setPendingFileMutation({
        action: 'chmod',
        scope,
        directory,
        paths: selectedEntries.map((item) => item.path),
        name: `已选 ${selectedEntries.length} 项`,
      });
      return;
    }

    if (!entry) {
      return;
    }

    setFileMutationValue(entry.permissions?.trim() || (entry.kind === 'directory' ? '755' : '644'));
    setPendingFileMutation({
      action: 'chmod',
      scope,
      directory,
      path: entry.path,
      entryKind: entry.kind,
      name: entry.name,
    });
  };

  const openDeleteEntryDialog = (
    scope: FileMutationScope,
    targetEntry?: BrowseEntry | null,
  ) => {
    const selectedEntries = scope === 'local' ? selectedLocalEntries : selectedRemoteEntries;
    const directory = scope === 'local' ? workbenchState?.local.directory : workbenchState?.remote.directory;
    const entry = targetEntry ?? (selectedEntries.length === 1 ? selectedEntries[0] : null);
    if ((!entry && selectedEntries.length === 0) || !directory) {
      return;
    }

    if (!targetEntry && selectedEntries.length > 1) {
      setFileMutationValue('');
      setPendingFileMutation({
        action: 'delete',
        scope,
        directory,
        paths: selectedEntries.map((item) => item.path),
        name: `已选 ${selectedEntries.length} 项`,
      });
      return;
    }

    if (!entry) {
      return;
    }

    setFileMutationValue(entry.name);
    setPendingFileMutation({
      action: 'delete',
      scope,
      directory,
      path: entry.path,
      entryKind: entry.kind,
      name: entry.name,
    });
  };

  const handleDismissFilePreview = () => {
    if (isSavingFilePreview) {
      return;
    }

    if (
      isFilePreviewDirty &&
      typeof window !== 'undefined' &&
      !window.confirm('当前文件还有未保存修改，确定关闭吗？')
    ) {
      return;
    }

    previewRequestRef.current += 1;
    setIsLoadingFilePreview(false);
    setIsSavingFilePreview(false);
    setFilePreviewValue('');
    setSavedFilePreviewValue('');
    setPendingFilePreview(null);
  };

  const openFilePreview = async (scope: FileMutationScope, targetEntry?: BrowseEntry | null) => {
    const entry =
      targetEntry ?? (scope === 'local' ? selectedLocalEntry : selectedRemoteEntry);
    if (!entry || entry.kind !== 'file' || !activeConnection) {
      return;
    }

    if (
      pendingFilePreview &&
      isFilePreviewDirty &&
      typeof window !== 'undefined' &&
      !window.confirm('当前文件还有未保存修改，继续打开其他文件会丢失修改。确定继续吗？')
    ) {
      return;
    }

    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    setFilePreviewValue('');
    setSavedFilePreviewValue('');
    setPendingFilePreview({
      scope,
      path: entry.path,
      name: entry.name,
      result: null,
      runtimeMode: null,
    });
    setIsLoadingFilePreview(true);

    try {
      const result = await loadFilePreview(activeConnection, scope, entry.path);
      if (previewRequestRef.current !== requestId) {
        return;
      }

      setPendingFilePreview({
        scope,
        path: entry.path,
        name: entry.name,
        result: result.data,
        runtimeMode: result.runtimeMode,
      });
      setFilePreviewValue(result.data.content ?? '');
      setSavedFilePreviewValue(result.data.content ?? '');
    } catch (error) {
      if (previewRequestRef.current === requestId) {
        setFilePreviewValue('');
        setSavedFilePreviewValue('');
        setPendingFilePreview(null);
        setNotice({
          tone: 'error',
          title: '文件预览失败',
          detail: error instanceof Error ? error.message : '未能读取文件内容。',
        });
      }
    } finally {
      if (previewRequestRef.current === requestId) {
        setIsLoadingFilePreview(false);
      }
    }
  };

  const handleCalculateMd5 = async (scope: FileMutationScope, targetEntry?: BrowseEntry | null) => {
    const entry = targetEntry ?? (scope === 'local' ? selectedLocalEntry : selectedRemoteEntry);
    if (!entry || !activeConnection) {
      return;
    }

    if (entry.kind !== 'file') {
      setNotice({
        tone: 'info',
        title: '只能计算文件 MD5',
        detail: entry.name,
      });
      return;
    }

    setIsCalculatingDigest(true);
    setNotice({
      tone: 'info',
      title: '正在计算 MD5',
      detail: entry.name,
    });

    try {
      const result = await calculateMd5(activeConnection, scope, entry.path);
      setPendingFileDigest({
        scope,
        path: entry.path,
        name: entry.name,
        result: result.data,
        runtimeMode: result.runtimeMode,
      });
      setNotice({
        tone: 'success',
        title: 'MD5 已生成',
        detail: `${entry.name} · ${result.data.md5}`,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: 'MD5 计算失败',
        detail: error instanceof Error ? error.message : '未能计算文件 MD5。',
      });
    } finally {
      setIsCalculatingDigest(false);
    }
  };

  const handleDismissFileDigest = () => {
    if (!isCalculatingDigest) {
      setPendingFileDigest(null);
    }
  };

  const handleCopyFileDigest = async () => {
    if (!pendingFileDigest) {
      return;
    }

    try {
      await navigator.clipboard.writeText(pendingFileDigest.result.md5);
      setNotice({
        tone: 'success',
        title: 'MD5 已复制',
        detail: pendingFileDigest.name,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: '复制失败',
        detail: error instanceof Error ? error.message : '无法写入剪贴板。',
      });
    }
  };

  const handleSaveFilePreview = async () => {
    if (!pendingFilePreview || !pendingFilePreview.result || !activeConnection || !isEditableFilePreview) {
      return;
    }

    setIsSavingFilePreview(true);

    try {
      const result = await saveTextFile(
        activeConnection,
        pendingFilePreview.scope,
        pendingFilePreview.path,
        filePreviewValue,
      );
      const nextSize = new Blob([filePreviewValue]).size;

      setPendingFilePreview((current) =>
        current && current.result
          ? {
              ...current,
              runtimeMode: result.runtimeMode,
              result: {
                ...current.result,
                content: filePreviewValue,
                size: nextSize,
                truncated: false,
                isBinary: false,
                kind: 'text',
                mimeType: current.result.mimeType ?? 'text/plain',
              },
            }
          : current,
      );
      setSavedFilePreviewValue(filePreviewValue);

      if (workbenchState) {
        await refreshWorkbenchView(activeConnection, {
          localPath: workbenchState.local.directory,
          remotePath: workbenchState.remote.directory ?? activeConnection.path,
        });

        if (pendingFilePreview.scope === 'local') {
          setSelectedLocalPaths([pendingFilePreview.path]);
          setSelectedLocalPath(pendingFilePreview.path);
        } else {
          setSelectedRemotePaths([pendingFilePreview.path]);
          setSelectedRemotePath(pendingFilePreview.path);
        }
      }

      setNotice({
        tone: result.runtimeMode === 'preview' ? 'info' : 'success',
        title: result.runtimeMode === 'preview' ? '预览模式下已模拟保存' : '文件已保存',
        detail: pendingFilePreview.path,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: '文件保存失败',
        detail: error instanceof Error ? error.message : '未能写入文件内容。',
      });
    } finally {
      setIsSavingFilePreview(false);
    }
  };

  const handleFilePreviewKeyDown = (event: ReactKeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') {
      return;
    }

    event.preventDefault();
    if (!isFilePreviewDirty || isSavingFilePreview) {
      return;
    }

    void handleSaveFilePreview();
  };

  const handleOpenEntry = async (scope: FileMutationScope, targetEntry?: BrowseEntry | null) => {
    const entry =
      targetEntry ?? (scope === 'local' ? selectedLocalEntry : selectedRemoteEntry);
    if (!entry || entry.kind !== 'file' || !activeConnection) {
      return;
    }

    try {
      const result = await openEntry(activeConnection, scope, entry.path);
      setNotice({
        tone: result.runtimeMode === 'preview' ? 'info' : 'success',
        title:
          result.runtimeMode === 'preview'
            ? '预览模式下无法真正打开文件'
            : result.data.cached
              ? '已下载到缓存并打开'
              : '已在系统中打开',
        detail:
          result.runtimeMode === 'preview'
            ? entry.name
            : result.data.cached
              ? result.data.path
              : entry.path,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: '打开失败',
        detail: error instanceof Error ? error.message : '未能调用系统打开。',
      });
    }
  };

  const handleActivateWorkbenchEntry = async (
    scope: FileMutationScope,
    entry: BrowseEntry,
  ) => {
    if (entry.kind !== 'file') {
      return;
    }

    if (defaultFileAction(entry.path) === 'preview') {
      await openFilePreview(scope, entry);
      return;
    }

    await handleOpenEntry(scope, entry);
  };

  const handleDismissFileMutation = () => {
    if (isMutatingFiles) {
      return;
    }

    setPendingFileMutation(null);
    setFileMutationValue('');
  };

  const handleConfirmFileMutation = async () => {
    if (!pendingFileMutation || !activeConnection || !workbenchState) {
      return;
    }

    const value = fileMutationValue.trim();
    if (pendingFileMutation.action !== 'delete' && !value) {
      return;
    }

    setIsMutatingFiles(true);

    try {
      let affectedPath: string | null = null;

      if (pendingFileMutation.action === 'create-directory') {
        const result = await createDirectory(
          activeConnection,
          pendingFileMutation.scope,
          pendingFileMutation.directory,
          value,
        );
        affectedPath = result.data.path;
      } else if (pendingFileMutation.action === 'rename') {
        if (!pendingFileMutation.path) {
          return;
        }
        const result = await renameEntry(
          activeConnection,
          pendingFileMutation.scope,
          pendingFileMutation.path,
          value,
        );
        affectedPath = result.data.path;
      } else if (pendingFileMutation.action === 'copy') {
        const paths = pendingFileMutation.paths?.length
          ? pendingFileMutation.paths
          : pendingFileMutation.path
            ? [pendingFileMutation.path]
            : [];
        if (paths.length === 0) {
          return;
        }
        if (paths.length > 1) {
          for (const path of paths) {
            const sourceName = path.split('/').filter(Boolean).pop() ?? path;
            await copyEntry(
              activeConnection,
              pendingFileMutation.scope,
              path,
              joinDialogPath(value, sourceName),
            );
          }
        } else {
          const result = await copyEntry(
            activeConnection,
            pendingFileMutation.scope,
            paths[0],
            value,
          );
          affectedPath = result.data.path;
        }
      } else if (pendingFileMutation.action === 'move') {
        const paths = pendingFileMutation.paths?.length
          ? pendingFileMutation.paths
          : pendingFileMutation.path
            ? [pendingFileMutation.path]
            : [];
        if (paths.length === 0) {
          return;
        }
        if (paths.length > 1) {
          for (const path of paths) {
            const sourceName = path.split('/').filter(Boolean).pop() ?? path;
            await moveEntry(
              activeConnection,
              pendingFileMutation.scope,
              path,
              joinDialogPath(value, sourceName),
            );
          }
        } else {
          const result = await moveEntry(
            activeConnection,
            pendingFileMutation.scope,
            paths[0],
            value,
          );
          affectedPath = result.data.path;
        }
      } else if (pendingFileMutation.action === 'chmod') {
        const paths = pendingFileMutation.paths?.length
          ? pendingFileMutation.paths
          : pendingFileMutation.path
            ? [pendingFileMutation.path]
            : [];
        if (paths.length === 0) {
          return;
        }
        if (paths.length > 1) {
          for (const path of paths) {
            await chmodEntry(
              activeConnection,
              pendingFileMutation.scope,
              path,
              value,
            );
          }
        } else {
          const result = await chmodEntry(
            activeConnection,
            pendingFileMutation.scope,
            paths[0],
            value,
          );
          affectedPath = result.data.path;
        }
      } else {
        const paths = pendingFileMutation.paths?.length
          ? pendingFileMutation.paths
          : pendingFileMutation.path
            ? [pendingFileMutation.path]
            : [];
        if (paths.length === 0) {
          return;
        }
        for (const path of paths) {
          await deleteEntry(activeConnection, pendingFileMutation.scope, path);
        }
      }

      clearBrowseCache();
      await refreshWorkbenchView(activeConnection, {
        localPath: workbenchState.local.directory,
        remotePath: workbenchState.remote.directory ?? activeConnection.path,
      });

      if (pendingFileMutation.scope === 'local') {
        setSelectedLocalPaths(pendingFileMutation.action === 'delete' ? [] : affectedPath ? [affectedPath] : []);
        setSelectedLocalPath(pendingFileMutation.action === 'delete' ? null : affectedPath);
      } else {
        setSelectedRemotePaths(pendingFileMutation.action === 'delete' ? [] : affectedPath ? [affectedPath] : []);
        setSelectedRemotePath(pendingFileMutation.action === 'delete' ? null : affectedPath);
      }

      const scopeName = scopeLabel(pendingFileMutation.scope);
      const title =
        pendingFileMutation.action === 'create-directory'
          ? `${scopeName}目录已创建`
          : pendingFileMutation.action === 'rename'
            ? `${scopeName}项目已重命名`
            : pendingFileMutation.action === 'copy'
              ? `${scopeName}项目已复制`
              : pendingFileMutation.action === 'move'
                ? `${scopeName}项目已移动`
                : pendingFileMutation.action === 'chmod'
                  ? `${scopeName}权限已更新`
            : `${scopeName}项目已删除`;
      const detail =
        pendingFileMutation.action === 'create-directory'
          ? value
          : pendingFileMutation.action === 'rename'
            ? `${pendingFileMutation.name} -> ${value}`
            : (pendingFileMutation.paths?.length ?? 0) > 1 && pendingFileMutation.action === 'copy'
              ? `${pendingFileMutation.paths!.length} 项 -> ${value}`
              : (pendingFileMutation.paths?.length ?? 0) > 1 && pendingFileMutation.action === 'move'
                ? `${pendingFileMutation.paths!.length} 项 -> ${value}`
                : (pendingFileMutation.paths?.length ?? 0) > 1 && pendingFileMutation.action === 'chmod'
                  ? `${pendingFileMutation.paths!.length} 项 -> ${value}`
            : pendingFileMutation.action === 'copy' || pendingFileMutation.action === 'move'
              ? `${pendingFileMutation.path} -> ${value}`
              : pendingFileMutation.action === 'chmod'
                ? `${pendingFileMutation.name} -> ${value}`
            : pendingFileMutation.name;

      setPendingFileMutation(null);
      setFileMutationValue('');
      setNotice({
        tone: 'success',
        title,
        detail,
      });
    } catch (error) {
      setNotice({
        tone: 'error',
        title: '文件操作失败',
        detail: error instanceof Error ? error.message : '未能完成文件操作。',
      });
    } finally {
      setIsMutatingFiles(false);
    }
  };

  const markTransferItemsCancelled = (transferIds: string[], message = '传输已取消') => {
    if (transferIds.length === 0) {
      return;
    }

    transferIds.forEach((transferId) => cancelledTransferIdsRef.current.add(transferId));
    const transferIdSet = new Set(transferIds);
    setTransferQueue((current) =>
      current.map((entry) =>
        transferIdSet.has(entry.id)
          ? {
              ...entry,
              status: 'cancelled',
              progress: entry.progress,
              speedBytesPerSecond: undefined,
              currentPath: undefined,
              currentFileBytes: undefined,
              currentFileTotalBytes: undefined,
              errorMessage: message,
              lastUpdatedAt: Date.now(),
            }
          : entry,
      ),
    );
  };

  const performTransfer = async (
    request: TransferRequest,
    conflictPolicy: TransferConflictPolicy,
  ) => {
    const { connection, targetConnection, direction, item, sourceName, localDirectory, remoteDirectory } = request;
    if (cancelledTransferIdsRef.current.has(item.id)) {
      markTransferItemsCancelled([item.id]);
      return;
    }

    const runningItem: TransferQueueItem = {
      ...item,
      status: 'running',
      progress: 8,
      bytesTransferred: 0,
      speedBytesPerSecond: undefined,
      filesTransferred: 0,
      skipped: 0,
      renamed: 0,
      errorMessage: undefined,
      currentPath: undefined,
      currentFileBytes: 0,
      currentFileTotalBytes: null,
      lastUpdatedAt: Date.now(),
      retryPayload: item.retryPayload ?? {
        connection,
        targetConnection,
        localDirectory,
        remoteDirectory,
        targetRemoteDirectory: request.targetRemoteDirectory,
      },
    };

    setTransferQueue((current) => upsertTransferQueueItem(current, runningItem));
    setNotice({
      tone: 'info',
      title: transferNoticeTitle(direction, 'running'),
      detail: `${sourceName} -> ${item.targetPath}`,
    });

    try {
      const result = await executeTransfer(connection, item, conflictPolicy, targetConnection);
      if (cancelledTransferIdsRef.current.has(item.id)) {
        markTransferItemsCancelled([item.id]);
        return;
      }

      const completedItem: TransferQueueItem = {
        ...runningItem,
        status: 'done',
        progress: 100,
        bytesTransferred: result.data.bytesTransferred,
        speedBytesPerSecond: undefined,
        filesTransferred: result.data.filesTransferred,
        skipped: result.data.skipped,
        renamed: result.data.renamed,
        currentPath: undefined,
        currentFileBytes: undefined,
        currentFileTotalBytes: undefined,
        lastUpdatedAt: Date.now(),
      };

      setTransferQueue((current) =>
        current.map((entry) => (entry.id === item.id ? completedItem : entry)),
      );
      setNotice({
        tone: 'success',
        title: transferNoticeTitle(direction, 'done'),
        detail: transferCompletionDetail(sourceName, completedItem),
      });

      if (
        direction !== 'remoteCopy' &&
        result.runtimeMode === 'live' &&
        activeConnection &&
        sameConnectionEndpoint(activeConnection, connection)
      ) {
        clearBrowseCache();
        try {
          await refreshWorkbenchView(connection, {
            localPath: localDirectory,
            remotePath: remoteDirectory,
          });
        } catch (refreshError) {
          setNotice({
            tone: 'info',
            title: transferNoticeTitle(direction, 'refreshFailed'),
            detail: refreshError instanceof Error ? refreshError.message : '传输已完成，但目录刷新失败。',
          });
        }
      }
    } catch (error) {
      const cancelled = isTransferCancelled(error);

      setTransferQueue((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                status: cancelled ? 'cancelled' : 'failed',
                progress: entry.progress,
                lastUpdatedAt: Date.now(),
                speedBytesPerSecond: undefined,
                currentFileBytes: undefined,
                currentFileTotalBytes: undefined,
                errorMessage:
                  cancelled ? '传输已取消' : error instanceof Error ? error.message : '传输失败',
              }
            : entry,
        ),
      );
      setNotice({
        tone: cancelled ? 'info' : 'error',
        title: cancelled ? '传输已取消' : transferNoticeTitle(direction, 'failed'),
        detail: cancelled ? sourceName : error instanceof Error ? error.message : '传输失败。',
      });
    }
  };

  const runTransferRequests = async (requests: TransferRequest[]) => {
    if (requests.length === 0) {
      return;
    }

    for (const [index, request] of requests.entries()) {
      if (cancelledTransferIdsRef.current.has(request.item.id)) {
        markTransferItemsCancelled([request.item.id]);
        continue;
      }

      try {
        const conflicts = await inspectTransferConflicts(request.connection, request.item, request.targetConnection);
        if (cancelledTransferIdsRef.current.has(request.item.id)) {
          markTransferItemsCancelled([request.item.id]);
          continue;
        }

        if (conflicts.data.length > 0) {
          setTransferQueue((current) =>
            current.map((entry) =>
              entry.id === request.item.id
                ? {
                    ...entry,
                    lastUpdatedAt: Date.now(),
                    currentPath: '等待处理冲突',
                  }
                : entry,
            ),
          );
          setPendingTransferConflict({
            request,
            conflicts: conflicts.data,
            remainingRequests: requests.slice(index + 1),
          });
          setNotice({
            tone: 'info',
            title: '发现传输冲突',
            detail: `${request.sourceName} 需要你决定如何处理。`,
          });
          return;
        }

        await performTransfer(request, 'overwrite');
      } catch (error) {
        if (cancelledTransferIdsRef.current.has(request.item.id)) {
          markTransferItemsCancelled([request.item.id]);
          continue;
        }

        setTransferQueue((current) =>
          current.map((entry) =>
            entry.id === request.item.id
              ? {
                  ...entry,
                  status: 'failed',
                  progress: entry.progress,
                  lastUpdatedAt: Date.now(),
                  currentPath: undefined,
                  errorMessage: error instanceof Error ? error.message : '未能完成传输准备。',
                }
              : entry,
          ),
        );
        setNotice({
          tone: 'error',
          title: '无法检查传输冲突',
          detail: error instanceof Error ? error.message : '未能完成冲突检查。',
        });
        return;
      }
    }

    if (requests.length > 1) {
      setNotice({
        tone: 'success',
        title: transferNoticeTitle(requests[0].direction, 'batchDone'),
        detail: `共处理 ${requests.length} 项。`,
      });
    }
  };

  const handleQueueTransfer = async (
    direction: TransferDirection,
    targetEntry?: BrowseEntry | null,
  ) => {
    if (!workbenchState || !activeConnection) {
      setNotice({
        tone: 'info',
        title: '先连接远端',
        detail: '连接后再选择文件加入传输队列。',
      });
      setIsConnectionDialogOpen(true);
      return;
    }

    const selectedEntries = direction === 'upload' ? selectedLocalEntries : selectedRemoteEntries;
    const sourceEntries =
      targetEntry != null ? [targetEntry] : selectedEntries.length > 0 ? selectedEntries : [];
    const targetDirectory =
      direction === 'upload' ? workbenchState.remote.directory : workbenchState.local.directory;

    if (sourceEntries.length === 0) {
      setNotice({
        tone: 'info',
        title: direction === 'upload' ? '先选择本地文件' : '先选择远端文件',
        detail: '单击文件列表里的项目后，再加入传输队列；支持 Cmd/Ctrl 或 Shift 多选。',
      });
      return;
    }

    const requests: TransferRequest[] = sourceEntries.map((sourceEntry) => ({
      connection: activeConnection,
      direction,
      item: createTransferQueueItem(
        direction,
        sourceEntry,
        targetDirectory,
        {
          connection: activeConnection,
          localDirectory: workbenchState.local.directory,
          remoteDirectory: workbenchState.remote.directory,
        },
      ),
      sourceName: sourceEntry.name,
      localDirectory: workbenchState.local.directory,
      remoteDirectory: workbenchState.remote.directory,
    }));
    requests.forEach((request) => cancelledTransferIdsRef.current.delete(request.item.id));
    setTransferQueue((current) =>
      requests.reduce(
        (queue, request) =>
          upsertTransferQueueItem(queue, {
            ...request.item,
            currentPath: '检查冲突中',
            lastUpdatedAt: Date.now(),
          }),
        current,
      ),
    );
    setNotice({
      tone: 'info',
      title: direction === 'upload' ? '已加入上传队列' : '已加入下载队列',
      detail:
        sourceEntries.length > 1
          ? `${sourceEntries.length} 项 · 目标：${targetDirectory}`
          : `${sourceEntries[0].name} · 目标：${targetDirectory}`,
    });

    await runTransferRequests(requests);
  };

  const openRemoteCopyDialog = (targetEntry?: BrowseEntry | null) => {
    if (!workbenchState || !activeConnection) {
      setNotice({
        tone: 'info',
        title: '先连接源远端',
        detail: '连接远端目录后，再选择要复制到其他远端的项目。',
      });
      setIsConnectionDialogOpen(true);
      return;
    }

    const sourceEntries =
      targetEntry != null ? [targetEntry] : selectedRemoteEntries.length > 0 ? selectedRemoteEntries : [];

    if (sourceEntries.length === 0) {
      setNotice({
        tone: 'info',
        title: '先选择远端文件',
        detail: '单击远端列表里的项目后，再复制到其他远端；支持 Cmd/Ctrl 或 Shift 多选。',
      });
      return;
    }

    const candidates = favoriteConnections.filter(
      (favorite) => !sameConnectionEndpoint(hydrateConnectionDraft(toDraftFromFavorite(favorite)), activeConnection),
    );

    if (candidates.length === 0) {
      setNotice({
        tone: 'info',
        title: '没有可用的目标远端',
        detail: '请先在主机栏保存另一个远端收藏，再发起远端复制。',
      });
      return;
    }

    const targetFavorite =
      candidates.find((favorite) => favorite.id === remoteCopyTargetFavoriteId) ?? candidates[0];
    const targetDraft = hydrateConnectionDraft(toDraftFromFavorite(targetFavorite));

    setRemoteCopyTargetFavoriteId(targetFavorite.id);
    setRemoteCopyTargetDirectory(normalizeConnectionPath(targetDraft.path));
    setPendingRemoteCopy({
      sourceConnection: activeConnection,
      sourceDirectory: workbenchState.remote.directory,
      localDirectory: workbenchState.local.directory,
      entries: sourceEntries,
    });
  };

  const handleDismissRemoteCopyDialog = () => {
    setPendingRemoteCopy(null);
  };

  const handleSelectRemoteCopyTarget = (favorite: FavoriteItem) => {
    const targetDraft = hydrateConnectionDraft(toDraftFromFavorite(favorite));
    setRemoteCopyTargetFavoriteId(favorite.id);
    setRemoteCopyTargetDirectory(normalizeConnectionPath(targetDraft.path));
  };

  const handleConfirmRemoteCopy = async () => {
    if (!pendingRemoteCopy) {
      return;
    }

    const targetFavorite = favoriteConnections.find(
      (favorite) => favorite.id === remoteCopyTargetFavoriteId,
    );

    if (!targetFavorite) {
      setNotice({
        tone: 'error',
        title: '目标远端不可用',
        detail: '请选择一个已保存的远端收藏。',
      });
      return;
    }

    let targetConnection = hydrateConnectionDraft(toDraftFromFavorite(targetFavorite));
    targetConnection = await hydrateFavoritePassword(targetFavorite, targetConnection);

    if (sameConnectionEndpoint(targetConnection, pendingRemoteCopy.sourceConnection)) {
      setNotice({
        tone: 'info',
        title: '请选择其他远端',
        detail: '当前第一版用于跨远端复制；同一远端内复制请继续使用“复制到...”。',
      });
      return;
    }

    if (needsConnectionDialog(targetConnection)) {
      setPendingRemoteCopy(null);
      openConnectionDialogWithDraft(targetConnection, {
        tone: 'info',
        title: '补全目标远端凭据',
        detail: '远端复制需要目标主机的用户名或密码信息。',
      });
      return;
    }

    const targetDirectory = normalizeConnectionPath(remoteCopyTargetDirectory || targetConnection.path);
    const requests: TransferRequest[] = pendingRemoteCopy.entries.map((sourceEntry) => ({
      connection: pendingRemoteCopy.sourceConnection,
      targetConnection,
      direction: 'remoteCopy',
      item: createTransferQueueItem(
        'remoteCopy',
        sourceEntry,
        targetDirectory,
        {
          connection: pendingRemoteCopy.sourceConnection,
          targetConnection,
          localDirectory: pendingRemoteCopy.localDirectory,
          remoteDirectory: pendingRemoteCopy.sourceDirectory,
          targetRemoteDirectory: targetDirectory,
        },
      ),
      sourceName: sourceEntry.name,
      localDirectory: pendingRemoteCopy.localDirectory,
      remoteDirectory: pendingRemoteCopy.sourceDirectory,
      targetRemoteDirectory: targetDirectory,
    }));
    requests.forEach((request) => cancelledTransferIdsRef.current.delete(request.item.id));

    setPendingRemoteCopy(null);
    setTransferQueue((current) =>
      requests.reduce(
        (queue, request) =>
          upsertTransferQueueItem(queue, {
            ...request.item,
            currentPath: '检查冲突中',
            lastUpdatedAt: Date.now(),
          }),
        current,
      ),
    );
    setNotice({
      tone: 'info',
      title: '已加入远端复制队列',
      detail:
        requests.length > 1
          ? `${requests.length} 项 · 目标：${targetDirectory}`
          : `${requests[0].sourceName} · 目标：${targetDirectory}`,
    });

    await runTransferRequests(requests);
  };

  const handleResolveTransferConflict = (policy: TransferConflictPolicy) => {
    if (!pendingTransferConflict) {
      return;
    }

    const { request, remainingRequests } = pendingTransferConflict;
    setPendingTransferConflict(null);
    void (async () => {
      await performTransfer(request, policy);
      await runTransferRequests(remainingRequests);
    })();
  };

  const handleDismissTransferConflict = () => {
    if (!pendingTransferConflict) {
      return;
    }

    const cancelledIds = [
      pendingTransferConflict.request.item.id,
      ...pendingTransferConflict.remainingRequests.map((request) => request.item.id),
    ];
    markTransferItemsCancelled(cancelledIds, '已取消冲突处理');
    setPendingTransferConflict(null);
    setNotice({
      tone: 'info',
      title: '已取消本次传输',
      detail:
        pendingTransferConflict.remainingRequests.length > 0
          ? `${pendingTransferConflict.request.sourceName}，以及后续 ${pendingTransferConflict.remainingRequests.length} 项`
          : pendingTransferConflict.request.sourceName,
    });
  };

  const handleCancelTransfer = (transferId: string) => {
    const item = transferQueue.find((entry) => entry.id === transferId);
    if (!item || (item.status !== 'running' && item.status !== 'queued')) {
      return;
    }

    cancelledTransferIdsRef.current.add(transferId);
    if (pendingTransferConflict) {
      if (pendingTransferConflict.request.item.id === transferId) {
        const remainingRequests = pendingTransferConflict.remainingRequests;
        setPendingTransferConflict(null);
        void runTransferRequests(remainingRequests);
      } else if (pendingTransferConflict.remainingRequests.some((request) => request.item.id === transferId)) {
        setPendingTransferConflict({
          ...pendingTransferConflict,
          remainingRequests: pendingTransferConflict.remainingRequests.filter(
            (request) => request.item.id !== transferId,
          ),
        });
      }
    }

    setNotice({
      tone: 'info',
      title: item.status === 'running' ? '正在取消传输' : '已取消排队传输',
      detail: item.name,
    });

    markTransferItemsCancelled([transferId]);
    if (item.status === 'queued') {
      return;
    }

    void cancelTransfer(transferId).catch((error) => {
      setNotice({
        tone: 'error',
        title: '取消失败',
        detail: error instanceof Error ? error.message : '未能取消传输。',
      });
    });
  };

  const handleRetryTransfer = async (transferId: string) => {
    const item = transferQueue.find((entry) => entry.id === transferId);
    if (!item || (item.status !== 'failed' && item.status !== 'cancelled')) {
      return;
    }

    if (!item.retryPayload) {
      setNotice({
        tone: 'error',
        title: '无法重试这项传输',
        detail: '当前缺少原始传输配置，请重新从文件列表发起一次传输。',
      });
      return;
    }

    const retriedItem: TransferQueueItem = {
      ...item,
      status: 'queued',
      progress: 0,
      bytesTransferred: 0,
      speedBytesPerSecond: undefined,
      filesTransferred: 0,
      skipped: 0,
      renamed: 0,
      currentPath: undefined,
      currentFileBytes: 0,
      currentFileTotalBytes: null,
      errorMessage: undefined,
      lastUpdatedAt: Date.now(),
      attemptCount: Math.max(1, item.attemptCount ?? 1) + 1,
    };

    cancelledTransferIdsRef.current.delete(retriedItem.id);
    setTransferQueue((current) => upsertTransferQueueItem(current, retriedItem));
    setNotice({
      tone: 'info',
      title: '重新加入传输队列',
      detail: `${item.name} · 第 ${Math.max(1, retriedItem.attemptCount ?? 1)} 次尝试`,
    });

    await runTransferRequests([
      {
        connection: item.retryPayload.connection,
        targetConnection: item.retryPayload.targetConnection,
        direction: item.direction,
        item: retriedItem,
        sourceName: item.name,
        localDirectory: item.retryPayload.localDirectory,
        remoteDirectory: item.retryPayload.remoteDirectory,
        targetRemoteDirectory: item.retryPayload.targetRemoteDirectory,
      },
    ]);
  };

  const handleClearCompletedTransfers = () => {
    setTransferQueue((current) => current.filter((item) => item.status !== 'done'));
  };

  const handleClearStoppedTransfers = () => {
    setTransferQueue((current) => {
      current.forEach((item) => {
        if (item.status === 'failed' || item.status === 'cancelled') {
          cancelledTransferIdsRef.current.delete(item.id);
        }
      });

      return current.filter((item) => item.status !== 'failed' && item.status !== 'cancelled');
    });
  };

  const handleRetryStoppedTransfers = async () => {
    const retryableIds = transferQueue
      .filter((item) => (item.status === 'failed' || item.status === 'cancelled') && item.retryPayload)
      .map((item) => item.id);

    if (retryableIds.length === 0) {
      setNotice({
        tone: 'info',
        title: '没有可重试的传输',
        detail: '失败或取消的任务需要保留原始传输配置才能重试。',
      });
      return;
    }

    for (const transferId of retryableIds) {
      await handleRetryTransfer(transferId);
    }
  };

  const handleStartTerminalSession = async () => {
    if (terminalSessionId || isStartingTerminal) {
      return;
    }

    setIsStartingTerminal(true);
    setTerminalDebugEntries([]);
    const favoriteIdForSession = resolveFavoriteIdForConnection(activeConnection);
    try {
      setTerminalOutput('[正在连接远端 SSH shell...]\r\n');
      if (!activeConnection || !supportsRemoteTerminal(activeConnection)) {
        throw new Error('当前连接不支持远端 PTY');
      }

      const workingDirectory =
        workbenchState?.remote.directory || activeConnection.path || remoteTerminalDirectory || '/';
      let terminalConnection = activeConnection;
      let enabledLegacy = false;
      let result;
      try {
        result = await startRemoteTerminalSession(terminalConnection, workingDirectory, {
          rows: 24,
          cols: 100,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (
          !isSshConnection(terminalConnection) ||
          terminalConnection.legacySshHostKeyAlgorithms ||
          !isLegacySshCompatibilityError(detail)
        ) {
          throw error;
        }

        terminalConnection = withLegacySshCompatibility(terminalConnection);
        enabledLegacy = true;
        setTerminalOutput((current) => `${current}[检测到旧 SSH 算法，已启用兼容模式并重试...]\r\n`.slice(-12000));
        result = await startRemoteTerminalSession(terminalConnection, workingDirectory, {
          rows: 24,
          cols: 100,
        });
      }

      if (enabledLegacy) {
        setActiveConnection(terminalConnection);
        setDraft((current) =>
          sameConnectionEndpoint(current, terminalConnection)
            ? {
                ...current,
                legacySshHostKeyAlgorithms: true,
              }
            : current,
        );
        setNotice({
          tone: 'success',
          title: '已自动启用旧 SSH 兼容',
          detail: '检测到旧服务器只提供 ssh-rsa/ssh-dss，远端终端已重试启动。',
        });
      }

      terminalSessionRef.current = result.data.sessionId;
      terminalSessionScopeRef.current = result.data.scope;
      setTerminalSessionId(result.data.sessionId);
      setTerminalSessionScope(result.data.scope);
      if (favoriteIdForSession) {
        const nextFavoriteSessions = {
          ...favoriteTerminalSessionsRef.current,
          [favoriteIdForSession]: {
            sessionId: result.data.sessionId,
            scope: result.data.scope,
          },
        };
        favoriteTerminalSessionsRef.current = nextFavoriteSessions;
        terminalSessionOwnerByIdRef.current[result.data.sessionId] = favoriteIdForSession;
        setFavoriteTerminalSessions(nextFavoriteSessions);
        const snapshot = workbenchSnapshotsRef.current[favoriteIdForSession];
        if (snapshot) {
          snapshot.terminalSessionId = result.data.sessionId;
          snapshot.terminalSessionScope = result.data.scope;
          snapshot.terminalOutput = '[正在连接远端 SSH shell...]\r\n';
          snapshot.terminalDebugEntries = [];
        }
      }
      appendTerminalDebug(`[ui.start] 已创建远端 PTY，会话 ${result.data.sessionId}`);
      setRemoteTerminalDirectory(result.data.currentDirectory);

      if (result.runtimeMode === 'preview') {
        setTerminalOutput((current) =>
          `${current}[preview] 当前浏览器预览不会启动真实 shell，桌面窗口会使用 PTY。\n`.slice(-12000),
        );
      }
    } catch (error) {
      setTerminalOutput('');
      setNotice({
        tone: 'error',
        title: '终端启动失败',
        detail: error instanceof Error ? error.message : '无法启动终端会话。',
      });
    } finally {
      setIsStartingTerminal(false);
    }
  };

  const handleStopTerminalSession = () => {
    if (!terminalSessionId) {
      return;
    }

    const closingSessionId = terminalSessionId;
    const ownerFavoriteId = terminalSessionOwnerByIdRef.current[closingSessionId] ?? resolveFavoriteIdForConnection(activeConnection);
    if (ownerFavoriteId) {
      const nextFavoriteSessions = Object.fromEntries(
        Object.entries(favoriteTerminalSessionsRef.current).filter(
          ([favoriteId]) => favoriteId !== ownerFavoriteId,
        ),
      );
      favoriteTerminalSessionsRef.current = nextFavoriteSessions;
      setFavoriteTerminalSessions(nextFavoriteSessions);
      delete terminalSessionOwnerByIdRef.current[closingSessionId];
      const snapshot = workbenchSnapshotsRef.current[ownerFavoriteId];
      if (snapshot) {
        snapshot.terminalSessionId = null;
        snapshot.terminalSessionScope = null;
      }
    }
    terminalSessionRef.current = null;
    terminalSessionScopeRef.current = null;
    setTerminalSessionId(null);
    setTerminalSessionScope(null);
    void closeTerminalSession(closingSessionId).catch((error) => {
      setNotice({
        tone: 'error',
        title: '关闭终端失败',
        detail: error instanceof Error ? error.message : '无法关闭终端会话。',
      });
    });
  };

  const handleSendTerminalInput = async (input: string, raw = false) => {
    const normalizedInput = raw || input.endsWith('\n') || input.endsWith('\r') ? input : `${input}\r`;

    if (!terminalSessionId && raw) {
      appendTerminalDebug(`[ui.input.skip] 没有活动 PTY，忽略 raw 输入，${normalizedInput.length} bytes`);
      return;
    }

    if (!terminalSessionId) {
      appendTerminalDebug(`[ui.input.autostart] 没有活动 PTY，准备自动启动并发送 ${normalizedInput.length} bytes`);
      await handleStartTerminalSession();
      const nextSessionId = terminalSessionRef.current;
      if (!nextSessionId) {
        appendTerminalDebug('[ui.input.autostart.failed] 自动启动后仍然没有 sessionId');
        return;
      }

      setTerminalOutput((current) => `${current}$ ${input.trim()}\n`.slice(-12000));
      appendTerminalDebug(`[ui.input.write] 自动启动后发送到 ${nextSessionId}，${normalizedInput.length} bytes`);
      await writeTerminalInput(nextSessionId, normalizedInput);
      return;
    }

    try {
      appendTerminalDebug(`[ui.input.write] 发送到 ${terminalSessionId}，${normalizedInput.length} bytes`);
      await writeTerminalInput(terminalSessionId, normalizedInput);
    } catch (error) {
      appendTerminalDebug(`[ui.input.error] ${error instanceof Error ? error.message : '无法写入终端会话。'}`);
      setNotice({
        tone: 'error',
        title: '终端输入失败',
        detail: error instanceof Error ? error.message : '无法写入终端会话。',
      });
    }
  };

  const handleClearTerminal = () => {
    if (!terminalSessionId) {
      setRemoteTerminalHistory([]);
    }
    setTerminalOutput('');
    const activeFavoriteId = resolveFavoriteIdForConnection(activeConnection);
    if (activeFavoriteId) {
      const snapshot = workbenchSnapshotsRef.current[activeFavoriteId];
      if (snapshot) {
        snapshot.terminalOutput = '';
      }
    }
  };

  const remoteBrowserDirectory = workbenchState?.remote.directory || activeConnection?.path || '/';
  const terminalDirectory = terminalSessionId
    ? remoteTerminalDirectory || remoteBrowserDirectory
    : remoteBrowserDirectory;
  const terminalLabel = `${activeConnection?.username?.trim() ? `${activeConnection.username.trim()}@` : ''}${
    activeConnection?.host?.trim() || '未连接远端'
  }${activeConnection?.port?.trim() ? `:${activeConnection.port.trim()}` : ''}`;
  const terminalProfile = activeConnection?.terminalProfile ?? 'auto';
  const remoteCopyTargetCandidates = favoriteConnections.filter(
    (favorite) =>
      !activeConnection ||
      !sameConnectionEndpoint(hydrateConnectionDraft(toDraftFromFavorite(favorite)), activeConnection),
  );
  const selectedRemoteCopyTarget =
    remoteCopyTargetCandidates.find((favorite) => favorite.id === remoteCopyTargetFavoriteId) ?? null;
  const remoteCopyTargetDirectoryOptions = selectedRemoteCopyTarget
    ? normalizeConnectionPaths([
        selectedRemoteCopyTarget.path,
        ...(selectedRemoteCopyTarget.paths ?? []),
      ])
    : [];
  const pendingFavoriteRemovalEndpoint = pendingFavoriteRemoval
    ? `${pendingFavoriteRemoval.protocol} · ${
        pendingFavoriteRemoval.username ? `${pendingFavoriteRemoval.username}@` : ''
      }${pendingFavoriteRemoval.host}${pendingFavoriteRemoval.port ? `:${pendingFavoriteRemoval.port}` : ''}`
    : '';

  return (
    <AppShell
    >
      <WorkbenchPage
        activeConnection={activeConnection}
        connectionResult={connectionResult}
        workbenchState={workbenchState}
        selectedLocalPath={selectedLocalPath}
        selectedRemotePath={selectedRemotePath}
        selectedLocalPaths={selectedLocalPaths}
        selectedRemotePaths={selectedRemotePaths}
        transferQueue={transferQueue}
        terminalDirectory={terminalDirectory}
        terminalLabel={terminalLabel}
        terminalHistory={remoteTerminalHistory}
        terminalSessionId={terminalSessionId}
        terminalOutput={terminalOutput}
        terminalCompletionConfig={terminalCompletionConfigFile.config}
        terminalProfile={terminalProfile}
        favorites={hasLoadedFavorites ? favoriteConnections : []}
        favoriteConnectionStateById={favoriteConnectionStateById}
        favoriteRemotePoolSummaryById={favoriteRemotePoolSummaryById}
        selectedFavoriteId={selectedFavoriteId}
        isRemoteBrowserConnected={isRemoteBrowserConnected}
        browserPaneErrors={browserPaneErrors}
        isRefreshingLocal={isRefreshingLocal}
        isRefreshingRemote={isRefreshingRemote}
        isOpeningConnection={isOpeningWorkbench}
        isSavingFavorite={isSavingFavorite}
        isMutatingFiles={isMutatingFiles}
        isRunningTerminal={false}
        isStartingTerminal={isStartingTerminal}
        showHidden={showHiddenFiles}
        openingConnectionId={openingConnectionId}
        onRefreshLocal={() => void handleRefreshLocalDirectory()}
        onRefreshRemote={() => void handleRefreshRemoteDirectory()}
        onToggleShowHidden={() => void handleToggleShowHidden()}
        onConnectRemoteBrowser={() => void handleConnectRemoteBrowser()}
        onDisconnectRemoteBrowser={handleDisconnectRemoteBrowser}
        onSelectLocalEntry={(entry, options) => handleSelectWorkbenchEntry('local', entry, options)}
        onSelectRemoteEntry={(entry, options) => handleSelectWorkbenchEntry('remote', entry, options)}
        onNavigateLocal={(path) => handleNavigateWorkbench('local', path)}
        onNavigateRemote={(path) => handleNavigateWorkbench('remote', path)}
        onActivateEntry={(scope, entry) => void handleActivateWorkbenchEntry(scope, entry)}
        onCreateDirectory={openCreateDirectoryDialog}
        onOpenEntry={(scope, entry) => void handleOpenEntry(scope, entry)}
        onPreviewEntry={(scope, entry) => void openFilePreview(scope, entry)}
        onMd5Entry={(scope, entry) => void handleCalculateMd5(scope, entry)}
        onRenameEntry={(scope, entry) => openRenameEntryDialog(scope, entry)}
        onCopyEntry={(scope, entry) => openCopyEntryDialog(scope, entry)}
        onMoveEntry={(scope, entry) => openMoveEntryDialog(scope, entry)}
        onChangePermissions={(scope, entry) => openChmodEntryDialog(scope, entry)}
        onDeleteEntry={(scope, entry) => openDeleteEntryDialog(scope, entry)}
        onQueueUpload={(entry) => void handleQueueTransfer('upload', entry)}
        onQueueDownload={(entry) => void handleQueueTransfer('download', entry)}
        onQueueRemoteCopy={(entry) => openRemoteCopyDialog(entry)}
        onOpenSearchDialog={openSearchDialog}
        onCancelTransfer={handleCancelTransfer}
        onRetryTransfer={(transferId) => void handleRetryTransfer(transferId)}
        onClearCompletedTransfers={handleClearCompletedTransfers}
        onClearStoppedTransfers={handleClearStoppedTransfers}
        onRetryStoppedTransfers={() => void handleRetryStoppedTransfers()}
        onStartTerminalSession={() => void handleStartTerminalSession()}
        onStopTerminalSession={handleStopTerminalSession}
        onSendTerminalInput={(input, raw) => void handleSendTerminalInput(input, raw)}
        onTerminalDebug={appendTerminalDebug}
        onClearTerminalHistory={handleClearTerminal}
        onOpenConnectionDialog={openConnectionDialog}
        onSelectFavoriteTab={handleSelectFavoriteTab}
        onOpenFavoriteConfig={handleOpenFavoriteConfig}
        onRenameFavoriteTab={handleRenameFavoriteFromTab}
        onRemoveFavoriteTab={handleRemoveFavoriteFromTab}
        onCloseFavoriteTerminal={handleCloseFavoriteTerminal}
        onDisconnectFavoriteConnection={handleDisconnectFavoriteConnection}
        onSaveFavoriteDirectory={(favorite) => void handleSaveFavoriteDirectory(favorite)}
        onOpenFavoriteDirectory={(favorite, path) => void handleOpenFavoriteDirectory(favorite, path)}
        canUseRemoteTerminal={canUseRemoteTerminal}
        styleMode={styleMode}
        onToggleStyleMode={onToggleStyleMode}
      />

      <Dialog
        open={Boolean(pendingRemoteCopy)}
        onClose={handleDismissRemoteCopyDialog}
        fullWidth
        maxWidth="xs"
        PaperProps={{
          sx: {
            width: 'min(440px, calc(100vw - 32px))',
            borderRadius: '14px',
            overflow: 'hidden',
            border: '1px solid var(--rterm-panel-border)',
            backgroundColor: (theme) =>
              theme.palette.mode === 'light' ? 'rgba(251,253,255,0.98)' : 'rgba(14,21,31,0.98)',
          },
        }}
      >
        <DialogTitle
          sx={{
            px: 2,
            pt: 1.75,
            pb: 0.65,
          }}
        >
          <Stack direction="row" justifyContent="space-between" spacing={1.2} alignItems="flex-start">
            <Stack spacing={0.35} sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: '1rem', fontWeight: 760, lineHeight: 1.15 }} noWrap>
                复制到其他远端
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                title={pendingRemoteCopy?.sourceDirectory}
                sx={{ fontSize: '0.72rem', lineHeight: 1.2 }}
              >
                {pendingRemoteCopy
                  ? `${pendingRemoteCopy.entries.length} 项 · ${pendingRemoteCopy.sourceDirectory}`
                  : ''}
              </Typography>
            </Stack>
            <IconButton
              onClick={handleDismissRemoteCopyDialog}
              size="small"
              color="inherit"
              sx={{ width: 32, height: 32, borderRadius: '9px', mt: -0.45 }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ px: 2, pb: 1.75, pt: 0.9 }}>
          <Stack spacing={1.15}>
            <TextField
              select
              label="目标远端"
              size="small"
              value={selectedRemoteCopyTarget?.id ?? ''}
              onChange={(event) => {
                const favorite = remoteCopyTargetCandidates.find(
                  (record) => record.id === event.target.value,
                );
                if (favorite) {
                  handleSelectRemoteCopyTarget(favorite);
                }
              }}
              SelectProps={{
                renderValue: (value) => {
                  const favorite = remoteCopyTargetCandidates.find((record) => record.id === String(value));
                  return favorite?.name || favorite?.host || '';
                },
                MenuProps: {
                  PaperProps: {
                    sx: {
                      mt: 0.45,
                      borderRadius: '10px',
                      '& .MuiMenuItem-root': {
                        minHeight: 34,
                      },
                    },
                  },
                },
              }}
              fullWidth
              sx={{
                '& .MuiInputLabel-root': {
                  fontSize: '0.76rem',
                },
                '& .MuiOutlinedInput-root': {
                  minHeight: 38,
                  borderRadius: '9px',
                  fontSize: '0.82rem',
                },
              }}
            >
              {remoteCopyTargetCandidates.map((favorite) => {
                const targetDraft = hydrateConnectionDraft(toDraftFromFavorite(favorite));
                const endpoint = `${targetDraft.protocol} · ${
                  targetDraft.username ? `${targetDraft.username}@` : ''
                }${targetDraft.host}${targetDraft.port ? `:${targetDraft.port}` : ''}`;

                return (
                  <MenuItem
                    key={favorite.id}
                    value={favorite.id}
                    sx={{ minHeight: 34, fontSize: '0.82rem', gap: 1 }}
                  >
                    <Typography component="span" noWrap sx={{ fontSize: '0.82rem', fontWeight: 700 }}>
                      {favorite.name || favorite.host}
                    </Typography>
                    <Typography
                      component="span"
                      noWrap
                      color="text.secondary"
                      sx={{ minWidth: 0, fontSize: '0.72rem' }}
                    >
                      {endpoint}
                    </Typography>
                  </MenuItem>
                );
              })}
            </TextField>
            <Autocomplete
              freeSolo
              selectOnFocus
              handleHomeEndKeys
              value={remoteCopyTargetDirectory || null}
              inputValue={remoteCopyTargetDirectory}
              options={remoteCopyTargetDirectoryOptions}
              noOptionsText="输入目录后按 Enter"
              filterOptions={(options, state) => {
                const filtered = filterRemoteCopyDirectoryOptions(options, state);
                const normalizedInput = state.inputValue.trim()
                  ? normalizeConnectionPath(state.inputValue)
                  : '';
                if (normalizedInput && !options.includes(normalizedInput)) {
                  filtered.push(normalizedInput);
                }

                return filtered;
              }}
              onInputChange={(_event, value, reason) => {
                if (reason === 'input' || reason === 'clear') {
                  setRemoteCopyTargetDirectory(value);
                }
              }}
              onChange={(_event, value) => {
                if (typeof value === 'string') {
                  setRemoteCopyTargetDirectory(normalizeConnectionPath(value));
                }
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="目标目录"
                  size="small"
                  placeholder="/tmp"
                  inputProps={{ ...params.inputProps, ...plainInputBehaviorProps }}
                  sx={{
                    '& .MuiInputLabel-root': {
                      fontSize: '0.76rem',
                    },
                    '& .MuiOutlinedInput-root': {
                      minHeight: 38,
                      borderRadius: '9px',
                      fontSize: '0.82rem',
                    },
                    '& .MuiOutlinedInput-input': {
                      py: 0.92,
                    },
                  }}
                />
              )}
              renderOption={(props, option) => {
                const { key, ...optionProps } = props;
                return (
                  <MenuItem key={key} {...optionProps} component="li" sx={{ minHeight: 34, fontSize: '0.82rem' }}>
                    <Typography variant="body2" noWrap title={option} sx={{ minWidth: 0 }}>
                      {option}
                    </Typography>
                  </MenuItem>
                );
              }}
              slotProps={{
                paper: {
                  sx: {
                    mt: 0.45,
                    borderRadius: '10px',
                    '& .MuiAutocomplete-listbox': {
                      py: 0.35,
                    },
                  },
                },
              }}
              fullWidth
            />
            <Stack direction="row" spacing={0.8} justifyContent="flex-end" sx={{ pt: 0.25 }}>
              <Button
                onClick={handleDismissRemoteCopyDialog}
                color="inherit"
                sx={{ minHeight: 34, borderRadius: '9px', px: 1.45, fontSize: '0.8rem' }}
              >
                取消
              </Button>
              <Button
                variant="contained"
                onClick={() => void handleConfirmRemoteCopy()}
                disabled={!pendingRemoteCopy || !selectedRemoteCopyTarget}
                sx={{ minHeight: 34, borderRadius: '9px', px: 1.65, fontSize: '0.8rem' }}
              >
                加入队列
              </Button>
            </Stack>
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingSearch)}
        onClose={dismissSearch}
        fullWidth
        maxWidth={false}
        slotProps={{
          backdrop: {
            sx: {
              backgroundColor: (theme) =>
                theme.palette.mode === 'light' ? 'rgba(31,34,39,0.3)' : 'rgba(0,0,0,0.56)',
              backdropFilter: 'blur(2px)',
            },
          },
        }}
        PaperProps={{
          sx: {
            width: { xs: 'calc(100vw - 28px)', sm: 640 },
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'min(82vh, 680px)',
            borderRadius: '16px',
            border: '1px solid var(--rterm-accent-border)',
            backgroundColor: (theme) =>
              theme.palette.mode === 'light' ? 'rgba(251,253,255,0.985)' : 'rgba(14,21,31,0.985)',
            boxShadow: (theme) =>
              theme.palette.mode === 'light'
                ? '0 24px 72px rgba(37,99,235,0.2), 0 1px 0 rgba(255,255,255,0.86) inset'
                : '0 28px 82px rgba(0,0,0,0.58), 0 1px 0 rgba(255,255,255,0.08) inset',
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle sx={{ px: { xs: 1.55, sm: 1.8 }, py: 1.25, pb: 0.9 }}>
          <Stack direction="row" justifyContent="space-between" spacing={1.2} alignItems="center">
            <Stack spacing={0.2} sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={760} noWrap sx={{ letterSpacing: 0 }}>
                {searchDialogTitle(pendingSearch)}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                sx={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: '0.72rem',
                }}
              >
                {searchDialogSubtitle(pendingSearch)}
              </Typography>
            </Stack>
            <IconButton
              onClick={dismissSearch}
              size="small"
              color="inherit"
              aria-label="关闭搜索"
              sx={{
                width: 34,
                height: 34,
                flexShrink: 0,
                border: '1px solid var(--rterm-panel-border)',
                backgroundColor: 'var(--rterm-control-bg)',
                '&:hover': {
                  color: 'var(--rterm-accent)',
                  backgroundColor: 'var(--rterm-accent-soft)',
                },
              }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ px: { xs: 1.55, sm: 1.8 }, pb: 1.6, pt: 0 }}>
          <Stack spacing={0.9}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={pendingSearch?.mode ?? 'content'}
              onChange={(_, value: SearchMode | null) => {
                if (!value || isSearching) {
                  return;
                }

                setPendingSearch((current) =>
                  current
                    ? {
                        ...current,
                        mode: value,
                        result: null,
                        runtimeMode: null,
                      }
                    : current,
                );
              }}
              sx={{
                alignSelf: 'flex-start',
                borderRadius: '10px',
                p: 0.22,
                border: '1px solid var(--rterm-panel-border)',
                backgroundColor: 'var(--rterm-control-bg)',
                '& .MuiToggleButton-root': {
                  minWidth: 74,
                  px: 1,
                  py: 0.38,
                  border: 0,
                  borderRadius: '8px !important',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  letterSpacing: 0,
                  color: 'text.secondary',
                  '&.Mui-selected': {
                    color: 'var(--rterm-accent)',
                    backgroundColor: 'var(--rterm-accent-soft)',
                  },
                },
              }}
            >
              <ToggleButton value="content" disabled={isSearching} aria-label="内容搜索">
                内容
              </ToggleButton>
              <ToggleButton value="name" disabled={isSearching} aria-label="名称搜索">
                名称
              </ToggleButton>
            </ToggleButtonGroup>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75}>
              <TextField
                fullWidth
                autoFocus
                size="small"
                value={searchQueryValue}
                onChange={(event) => setSearchQueryValue(event.target.value)}
                placeholder={pendingSearch?.mode === 'content' ? '输入要查找的文本' : '输入文件名或目录名'}
                disabled={isSearching}
                inputProps={plainInputBehaviorProps}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !isSearching) {
                    event.preventDefault();
                    void runSearch();
                  }
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRoundedIcon sx={{ fontSize: 18, color: 'var(--rterm-accent)' }} />
                    </InputAdornment>
                  ),
                }}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    minHeight: 38,
                    borderRadius: '12px',
                    backgroundColor: (theme) =>
                      theme.palette.mode === 'light' ? 'rgba(255,255,255,0.82)' : 'rgba(255,255,255,0.04)',
                    '& fieldset': {
                      borderColor: 'var(--rterm-panel-border)',
                    },
                    '&:hover fieldset': {
                      borderColor: 'var(--rterm-accent-border)',
                    },
                    '&.Mui-focused fieldset': {
                      borderWidth: 1,
                      borderColor: 'var(--rterm-accent)',
                    },
                  },
                  '& .MuiInputBase-input': {
                    py: 0.86,
                    fontSize: '0.88rem',
                  },
                }}
              />
              <Button
                variant={isSearching ? 'outlined' : 'contained'}
                onClick={() => (isSearching ? cancelRunningSearch() : void runSearch())}
                disabled={!isSearching && !searchQueryValue.trim()}
                sx={{
                  minHeight: 38,
                  minWidth: { xs: '100%', sm: 80 },
                  borderRadius: '12px',
                  px: 1.55,
                  fontSize: '0.83rem',
                  fontWeight: 720,
                  boxShadow: 'none',
                  '&:hover': {
                    boxShadow: 'none',
                  },
                }}
              >
                {isSearching ? '取消' : '搜索'}
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.45 }}>
              {pendingSearch?.targets.length
                ? '范围：已选文件、文件夹或压缩包。'
                : pendingSearch?.mode === 'content'
                  ? '范围：当前目录及子目录的文件内容。'
                  : '范围：当前目录及子目录的名称。'}
            </Typography>
            {pendingSearch?.runtimeMode === 'preview' ? (
              <Typography variant="caption" color="text.secondary">
                当前为浏览器样例搜索，桌面窗口中会执行真实递归搜索。
              </Typography>
            ) : null}
            {pendingSearch?.result?.capped ? (
              <Typography variant="caption" color="text.secondary">
                结果较多，当前仅展示前 {pendingSearch.result.totalMatches} 条匹配。
              </Typography>
            ) : null}
            <Box
              sx={{
                minHeight: pendingSearch?.result ? 260 : 148,
                maxHeight: 'min(48vh, 390px)',
                overflow: 'auto',
                borderRadius: '13px',
                border: '1px solid var(--rterm-panel-border)',
                backgroundColor: 'var(--rterm-control-bg)',
                p: 0.45,
                '&::-webkit-scrollbar': {
                  width: 7,
                },
                '&::-webkit-scrollbar-thumb': {
                  backgroundColor: (theme) =>
                    theme.palette.mode === 'light' ? 'rgba(31,34,39,0.2)' : 'rgba(255,255,255,0.16)',
                  borderRadius: 999,
                },
              }}
            >
              {isSearching ? (
                <Stack direction="row" spacing={0.8} alignItems="center" sx={{ px: 0.6, py: 0.7 }}>
                  <CircularProgress size={15} />
                  <Typography variant="body2" color="text.secondary">
                    正在递归搜索...
                  </Typography>
                </Stack>
              ) : pendingSearch?.result ? (
                pendingSearch.result.searchMode === 'content' ? (
                  pendingSearch.result.matches.length > 0 ? (
                    <Stack spacing={0.35}>
                      {pendingSearch.result.matches.map((match, index) => (
                        <Box
                          key={`${match.entry.path}:${match.lineNumber}:${index}`}
                          onClick={() => void handleRevealSearchEntry(match.entry, searchMatchDisplayPath(match))}
                          sx={{
                            px: 0.9,
                            py: 0.75,
                            borderRadius: '10px',
                            border: '1px solid var(--rterm-panel-border)',
                            backgroundColor: (theme) =>
                              theme.palette.mode === 'light'
                                ? 'rgba(255,255,255,0.62)'
                                : 'rgba(255,255,255,0.018)',
                            cursor: 'pointer',
                            transition: 'background-color 120ms ease, border-color 120ms ease',
                            '&:hover': {
                              backgroundColor: (theme) =>
                                theme.palette.mode === 'light'
                                  ? 'rgba(255,255,255,0.9)'
                                  : 'rgba(255,255,255,0.05)',
                              borderColor: 'var(--rterm-accent-border)',
                            },
                          }}
                        >
                          <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                            <Typography variant="body2" fontWeight={650} noWrap sx={{ minWidth: 0 }}>
                              {searchMatchDisplayName(match)}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                              {match.archivePath ? `压缩包内 · 第 ${match.lineNumber} 行` : `第 ${match.lineNumber} 行`}
                            </Typography>
                          </Stack>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', mt: 0.18, wordBreak: 'break-all' }}
                          >
                            {searchMatchDisplayPath(match)}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              mt: 0.55,
                              px: 0.8,
                              py: 0.55,
                              borderRadius: '8px',
                              color: 'text.primary',
                              backgroundColor: 'var(--rterm-accent-soft)',
                              wordBreak: 'break-word',
                            }}
                          >
                            {match.line}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ px: 0.6, py: 0.7 }}>
                      未找到匹配内容
                    </Typography>
                  )
                ) : pendingSearch.result.entries.length > 0 ? (
                  <Stack spacing={0.25}>
                    {pendingSearch.result.entries.map((entry) => (
                      <Box
                        key={entry.path}
                        onClick={() => void handleRevealSearchEntry(entry)}
                          sx={{
                            px: 0.85,
                            py: 0.75,
                            borderRadius: '10px',
                          border: '1px solid var(--rterm-panel-border)',
                          backgroundColor: (theme) =>
                            theme.palette.mode === 'light'
                              ? 'rgba(255,255,255,0.6)'
                              : 'rgba(255,255,255,0.015)',
                          cursor: 'pointer',
                          transition: 'background-color 120ms ease, border-color 120ms ease',
                          '&:hover': {
                            backgroundColor: (theme) =>
                              theme.palette.mode === 'light'
                                ? 'rgba(255,255,255,0.88)'
                                : 'rgba(255,255,255,0.045)',
                            borderColor: 'var(--rterm-accent-border)',
                          },
                        }}
                      >
                        <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                          <Typography variant="body2" fontWeight={600} noWrap sx={{ minWidth: 0 }}>
                            {entry.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                            {entry.kind === 'directory' ? '目录' : '文件'}
                          </Typography>
                        </Stack>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', mt: 0.2, wordBreak: 'break-all' }}
                        >
                          {entry.path}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ px: 0.6, py: 0.7 }}>
                    未找到匹配项目
                  </Typography>
                )
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ px: 0.6, py: 0.7 }}>
                  输入关键词后开始搜索
                </Typography>
              )}
            </Box>
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingFilePreview)}
        onClose={handleDismissFilePreview}
        fullWidth
        maxWidth="md"
        PaperProps={{
          sx: {
            borderRadius: '18px',
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle sx={{ px: 2, py: 1.35 }}>
          <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
            <Stack spacing={0.2} sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={700} noWrap>
                {pendingFilePreview?.name ?? '文件预览'}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {pendingFilePreview
                  ? `${scopeLabel(pendingFilePreview.scope)} · ${pendingFilePreview.path}`
                  : ''}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.75} alignItems="center">
              {isEditableFilePreview ? (
                <Button
                  variant={isFilePreviewDirty ? 'contained' : 'outlined'}
                  size="small"
                  onClick={() => void handleSaveFilePreview()}
                  disabled={isSavingFilePreview || !isFilePreviewDirty}
                >
                  {isSavingFilePreview ? '保存中...' : '保存'}
                </Button>
              ) : null}
              <IconButton
                onClick={handleDismissFilePreview}
                size="small"
                color="inherit"
                disabled={isSavingFilePreview}
              >
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ px: 2, pb: 2 }}>
          <Stack spacing={1}>
            {pendingFilePreview?.runtimeMode === 'preview' ? (
              <Typography variant="caption" color="text.secondary">
                当前为浏览器样例预览，桌面窗口中会读取真实文件内容。
              </Typography>
            ) : null}
            {pendingFilePreview?.result?.truncated ? (
              <Typography variant="caption" color="text.secondary">
                {pendingFilePreview.result.kind === 'text'
                  ? '仅显示前 128 KB 文本内容。'
                  : '文件超过 4 MB，当前未做内嵌展示。'}
              </Typography>
            ) : null}
            {isEditableFilePreview ? (
              <Typography variant="caption" color="text.secondary">
                支持直接编辑 UTF-8 文本文件，可用 Cmd/Ctrl + S 保存。
              </Typography>
            ) : null}
            <Box
              sx={{
                minHeight: 320,
                maxHeight: '68vh',
                overflow: 'auto',
                px: isEditableFilePreview ? 0.45 : 1.1,
                py: isEditableFilePreview ? 0.4 : 1,
                borderRadius: '14px',
                border: '1px solid rgba(255,255,255,0.08)',
                backgroundColor: 'rgba(255,255,255,0.02)',
              }}
            >
              {isLoadingFilePreview ? (
                <Typography variant="body2" color="text.secondary">
                  正在载入内容...
                </Typography>
              ) : pendingFilePreview?.result?.kind === 'image' && pendingFilePreview.result.dataUrl ? (
                <Box
                  component="img"
                  src={pendingFilePreview.result.dataUrl}
                  alt={pendingFilePreview.result.name}
                  sx={{
                    display: 'block',
                    width: '100%',
                    height: 'auto',
                    maxHeight: '62vh',
                    objectFit: 'contain',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(255,255,255,0.02)',
                  }}
                />
              ) : pendingFilePreview?.result?.kind === 'pdf' && pendingFilePreview.result.dataUrl ? (
                <Box
                  component="iframe"
                  src={pendingFilePreview.result.dataUrl}
                  title={pendingFilePreview.result.name}
                  sx={{
                    width: '100%',
                    minHeight: 560,
                    border: 0,
                    borderRadius: '10px',
                    backgroundColor: 'rgba(255,255,255,0.02)',
                  }}
                />
              ) : pendingFilePreview?.result?.kind === 'image' ||
                pendingFilePreview?.result?.kind === 'pdf' ? (
                <Stack spacing={0.35}>
                  <Typography variant="body2" fontWeight={600}>
                    暂不支持直接嵌入当前文件
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {pendingFilePreview.result.truncated
                      ? '文件较大，当前未内嵌展示，可直接使用系统打开。'
                      : '当前文件暂未生成可用的内嵌预览，可直接使用系统打开。'}
                  </Typography>
                </Stack>
              ) : pendingFilePreview?.result?.isBinary ? (
                <Stack spacing={0.35}>
                  <Typography variant="body2" fontWeight={600}>
                    暂不支持直接预览二进制文件
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    可以继续保留这条链路，下一步再接图片 / PDF / 外部打开。
                  </Typography>
                </Stack>
              ) : isEditableFilePreview ? (
                <TextField
                  fullWidth
                  multiline
                  minRows={16}
                  maxRows={28}
                  value={filePreviewValue}
                  onChange={(event) => setFilePreviewValue(event.target.value)}
                  onKeyDown={handleFilePreviewKeyDown}
                  disabled={isSavingFilePreview}
                  variant="outlined"
                  inputProps={plainInputBehaviorProps}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '12px',
                      alignItems: 'stretch',
                      backgroundColor: 'rgba(255,255,255,0.01)',
                    },
                    '& .MuiInputBase-inputMultiline': {
                      fontFamily:
                        '"SF Mono", "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace',
                      fontSize: '0.82rem',
                      lineHeight: 1.65,
                    },
                  }}
                />
              ) : (
                <Box
                  component="pre"
                  sx={{
                    m: 0,
                    color: 'text.primary',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily:
                      '"SF Mono", "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace',
                    fontSize: '0.82rem',
                    lineHeight: 1.65,
                  }}
                >
                  {pendingFilePreview?.result?.content ?? ''}
                </Box>
              )}
            </Box>
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingFileDigest)}
        onClose={handleDismissFileDigest}
        fullWidth
        maxWidth="xs"
        PaperProps={{
          sx: {
            borderRadius: '18px',
            overflow: 'hidden',
            backgroundImage:
              'linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.012))',
          },
        }}
      >
        <DialogTitle sx={{ px: 2, py: 1.3 }}>
          <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
            <Stack spacing={0.15} sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={700} noWrap>
                文件 MD5
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {pendingFileDigest
                  ? `${scopeLabel(pendingFileDigest.scope)} · ${pendingFileDigest.name}`
                  : ''}
              </Typography>
            </Stack>
            <IconButton onClick={handleDismissFileDigest} size="small" color="inherit" disabled={isCalculatingDigest}>
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ px: 2, pb: 2 }}>
          <Stack spacing={1}>
            <Box
              sx={{
                px: 1,
                py: 0.85,
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.07)',
                backgroundColor: 'rgba(255,255,255,0.025)',
              }}
            >
              <Stack spacing={0.65}>
                <Stack direction="row" justifyContent="space-between" spacing={1}>
                  <Typography variant="caption" color="text.secondary">
                    大小
                  </Typography>
                  <Typography variant="caption" color="text.primary">
                    {formatByteSize(pendingFileDigest?.result.size)}
                  </Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between" spacing={1}>
                  <Typography variant="caption" color="text.secondary">
                    来源
                  </Typography>
                  <Typography variant="caption" color="text.primary">
                    {pendingFileDigest?.runtimeMode === 'preview' ? '预览数据' : scopeLabel(pendingFileDigest?.scope ?? 'local')}
                  </Typography>
                </Stack>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', wordBreak: 'break-all' }}
                >
                  {pendingFileDigest?.path ?? ''}
                </Typography>
              </Stack>
            </Box>

            <Box
              sx={{
                px: 1,
                py: 0.9,
                borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.09)',
                backgroundColor: 'rgba(0,0,0,0.26)',
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontFamily:
                    '"SF Mono", "SFMono-Regular", ui-monospace, Menlo, Monaco, Consolas, monospace',
                  fontSize: '0.84rem',
                  lineHeight: 1.55,
                  wordBreak: 'break-all',
                }}
              >
                {pendingFileDigest?.result.md5 ?? ''}
              </Typography>
            </Box>

            <Button
              variant="contained"
              startIcon={<ContentCopyRoundedIcon fontSize="small" />}
              onClick={() => void handleCopyFileDigest()}
              disabled={!pendingFileDigest || isCalculatingDigest}
              fullWidth
            >
              复制 MD5
            </Button>
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingFileMutation)}
        onClose={handleDismissFileMutation}
        fullWidth
        maxWidth="xs"
        PaperProps={{
          sx: {
            borderRadius: '18px',
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle sx={{ px: 2, py: 1.35 }}>
          <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
            <Stack spacing={0.2}>
              <Typography variant="subtitle1" fontWeight={700}>
	                {pendingFileMutation?.action === 'create-directory'
	                  ? `新建${scopeLabel(pendingFileMutation.scope)}目录`
	                  : pendingFileMutation?.action === 'rename'
	                    ? `重命名${scopeLabel(pendingFileMutation.scope)}项目`
	                    : pendingFileMutation?.action === 'copy'
	                      ? `复制${scopeLabel(pendingFileMutation.scope)}项目`
	                      : pendingFileMutation?.action === 'move'
	                        ? `移动${scopeLabel(pendingFileMutation.scope)}项目`
	                        : pendingFileMutation?.action === 'chmod'
	                          ? `修改${scopeLabel(pendingFileMutation.scope)}权限`
	                    : `删除${pendingFileMutation ? scopeLabel(pendingFileMutation.scope) : ''}项目`}
	              </Typography>
	              <Typography variant="caption" color="text.secondary">
	                {pendingFileMutation?.action === 'create-directory'
	                  ? pendingFileMutation.directory
	                  : pendingFileMutation?.action === 'rename'
	                    ? pendingFileMutation.name
	                    : pendingFileMutation?.action === 'copy' ||
	                        pendingFileMutation?.action === 'move' ||
	                        pendingFileMutation?.action === 'chmod'
	                      ? pendingFileMutation.path ?? pendingFileMutation.name
	                    : (pendingFileMutation?.paths?.length ?? 0) > 1
	                      ? `会删除已选 ${pendingFileMutation!.paths!.length} 项。`
	                    : pendingFileMutation?.entryKind === 'directory'
	                      ? '会递归删除目录内容。'
	                      : pendingFileMutation?.name ?? '确认后将立即删除。'}
	              </Typography>
            </Stack>
            <IconButton onClick={handleDismissFileMutation} size="small" color="inherit" disabled={isMutatingFiles}>
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ px: 2, pb: 2 }}>
          <Stack spacing={1.1}>
            {pendingFileMutation?.action === 'delete' ? (
              <Box
                sx={{
                  px: 1,
                  py: 0.85,
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.07)',
                  backgroundColor: 'rgba(255,255,255,0.02)',
                }}
              >
	                <Typography variant="body2" sx={{ fontWeight: 600 }}>
	                  {pendingFileMutation.name}
	                </Typography>
	                {pendingFileMutation.path ? (
	                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15 }}>
	                    {pendingFileMutation.path}
	                  </Typography>
	                ) : (pendingFileMutation.paths?.length ?? 0) > 1 ? (
	                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15 }}>
	                    共 {pendingFileMutation.paths!.length} 项，将逐项删除。
	                  </Typography>
	                ) : null}
	              </Box>
            ) : (
              <TextField
                autoFocus
                fullWidth
                size="small"
                label={
                  pendingFileMutation?.action === 'create-directory'
                    ? '目录名'
                    : pendingFileMutation?.action === 'rename'
                      ? '新名称'
                      : pendingFileMutation?.action === 'chmod'
                        ? '权限模式'
                      : '目标路径'
                }
                value={fileMutationValue}
                onChange={(event) => setFileMutationValue(event.target.value)}
                disabled={isMutatingFiles}
                inputProps={plainInputBehaviorProps}
                helperText={
                  pendingFileMutation?.action === 'chmod'
                    ? '使用八进制格式，例如 755、644 或 0644'
                    : undefined
                }
              />
            )}

            <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={0.8}>
              <Button variant="outlined" fullWidth onClick={handleDismissFileMutation} disabled={isMutatingFiles}>
                取消
              </Button>
              <Button
                variant={pendingFileMutation?.action === 'delete' ? 'contained' : 'contained'}
                color={pendingFileMutation?.action === 'delete' ? 'error' : 'primary'}
                fullWidth
                onClick={() => void handleConfirmFileMutation()}
                disabled={
                  isMutatingFiles ||
                  (!pendingFileMutation || (pendingFileMutation.action !== 'delete' && !fileMutationValue.trim()))
                }
              >
                {isMutatingFiles
                  ? '处理中...'
                  : pendingFileMutation?.action === 'create-directory'
                    ? '创建'
                    : pendingFileMutation?.action === 'rename'
                      ? '保存'
                      : pendingFileMutation?.action === 'copy'
                        ? '复制'
                        : pendingFileMutation?.action === 'move'
                          ? '移动'
                          : pendingFileMutation?.action === 'chmod'
                            ? '应用'
                      : '删除'}
              </Button>
            </Stack>
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingTransferConflict)}
        onClose={handleDismissTransferConflict}
        fullWidth
        maxWidth="sm"
        PaperProps={{
          sx: {
            borderRadius: '18px',
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle sx={{ px: 2, py: 1.35 }}>
          <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
            <Stack spacing={0.2}>
              <Typography variant="subtitle1" fontWeight={700}>
                发现传输冲突
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {pendingTransferConflict
                  ? `${pendingTransferConflict.conflicts.length} 项目标内容已存在，选择一种处理方式。`
                  : '选择冲突处理方式。'}
              </Typography>
            </Stack>
            <IconButton onClick={handleDismissTransferConflict} size="small" color="inherit">
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ px: 2, pb: 2 }}>
          <Stack spacing={1.15}>
            <Stack spacing={0.55}>
              {(pendingTransferConflict?.conflicts ?? []).slice(0, 4).map((conflict) => (
                <Box
                  key={`${conflict.sourcePath}:${conflict.targetPath}`}
                  sx={{
                    px: 1,
                    py: 0.8,
                    borderRadius: '12px',
                    border: '1px solid rgba(255,255,255,0.07)',
                    backgroundColor: 'rgba(255,255,255,0.02)',
                  }}
                >
                  <Typography variant="body2" sx={{ fontSize: '0.86rem', fontWeight: 600 }}>
                    {conflictKindLabel(conflict.kind)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.15 }}>
                    {conflict.targetPath}
                  </Typography>
                </Box>
              ))}
              {(pendingTransferConflict?.conflicts.length ?? 0) > 4 ? (
                <Typography variant="caption" color="text.secondary">
                  还有 {pendingTransferConflict!.conflicts.length - 4} 项未展开显示。
                </Typography>
              ) : null}
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
              <Button
                variant="outlined"
                fullWidth
                onClick={() => handleResolveTransferConflict('overwrite')}
              >
                覆盖
              </Button>
              <Button
                variant="outlined"
                fullWidth
                onClick={() => handleResolveTransferConflict('skip')}
              >
                跳过
              </Button>
              <Button
                variant="contained"
                fullWidth
                onClick={() => handleResolveTransferConflict('rename')}
              >
                自动重命名
              </Button>
            </Stack>
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(pendingFavoriteRemoval)}
        onClose={handleDismissFavoriteRemoval}
        fullWidth
        maxWidth="xs"
        PaperProps={{
          sx: {
            borderRadius: '16px',
            overflow: 'hidden',
          },
        }}
      >
        <DialogTitle sx={{ px: 2, py: 1.28 }}>
          <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
            <Stack spacing={0.18} sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={700}>
                删除主机配置
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {pendingFavoriteRemoval?.name ?? ''}
              </Typography>
            </Stack>
            <IconButton onClick={handleDismissFavoriteRemoval} size="small" color="inherit">
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ px: 2, pb: 2 }}>
          <Stack spacing={1.15}>
            <Box
              sx={{
                px: 1,
                py: 0.82,
                borderRadius: '12px',
                border: (theme) => `1px solid ${theme.palette.divider}`,
                backgroundColor: (theme) =>
                  theme.palette.mode === 'light' ? 'rgba(31,34,39,0.025)' : 'rgba(255,255,255,0.025)',
              }}
            >
              <Typography variant="body2" fontWeight={700} noWrap>
                {pendingFavoriteRemoval?.name ?? '主机配置'}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.18 }}>
                {pendingFavoriteRemovalEndpoint}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
              删除后会从主机列表移除这个配置，已保存的密码也会一并清理。
            </Typography>
            <Stack direction="row" spacing={0.8} justifyContent="flex-end">
              <Button variant="outlined" onClick={handleDismissFavoriteRemoval}>
                取消
              </Button>
              <Button variant="contained" color="error" onClick={handleConfirmFavoriteRemoval}>
                删除
              </Button>
            </Stack>
          </Stack>
        </DialogContent>
      </Dialog>

      {isConnectionDialogOpen ? (
        <Dialog
          open
          onClose={closeConnectionDialog}
          fullWidth
          maxWidth={false}
          keepMounted={false}
          PaperProps={{
            sx: {
              borderRadius: '16px',
              overflow: 'hidden',
              width: { xs: 'calc(100vw - 22px)', md: 690 },
              maxWidth: 'calc(100vw - 24px)',
              height: 'auto',
              maxHeight: 'calc(100vh - 36px)',
              display: 'flex',
              flexDirection: 'column',
            },
          }}
        >
          <DialogTitle sx={{ px: 1.25, py: 0.82 }}>
            <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
              <Stack spacing={0.05}>
                <Typography variant="subtitle2" fontWeight={700}>
                  连接配置
                </Typography>
              </Stack>
              <IconButton onClick={closeConnectionDialog} size="small" color="inherit">
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
          </DialogTitle>
          <DialogContent
            sx={{
              px: { xs: 0.8, md: 0.9 },
              pb: { xs: 0.85, md: 0.9 },
              flex: '0 1 auto',
              minHeight: 0,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <SessionsPage
              embedded
              draft={draft}
              favorites={hasLoadedFavorites ? favoriteConnections : []}
              notice={notice}
              connectionResult={connectionResult}
              runtimeMode={runtimeMode}
              isTesting={isTesting}
              isOpeningWorkbench={isOpeningWorkbench}
              openingConnectionId={openingConnectionId}
              onDraftChange={updateDraft}
              onNewDraft={handleNewConnectionDraft}
              onSelectFavorite={(favorite) => void handleSelectFavoriteInDialog(favorite)}
              onOpenFavorite={handleOpenFavorite}
              isSavingFavorite={isSavingFavorite}
              onSaveDraftFavorite={handleSaveDraftFavorite}
              onRemoveFavorite={handleRequestRemoveFavorite}
              onRenameFavorite={handleRenameFavorite}
              onImportFavorites={(content) => void handleImportFavorites(content)}
              onExportFavorites={handleExportFavorites}
              onTestConnection={handleTestConnection}
              onOpenWorkbench={handleOpenWorkbench}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </AppShell>
  );
}

export default function App() {
  const [styleMode, setStyleMode] = useLocalStorageState<RTermStyleMode>('rterm.styleMode', 'dark');
  const theme = useMemo(() => createRTermTheme(styleMode), [styleMode]);

  useEffect(() => {
    document.documentElement.dataset.rtermStyle = styleMode;
    document.documentElement.style.colorScheme = styleMode;
  }, [styleMode]);

  const toggleStyleMode = () => {
    setStyleMode((current) => (current === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ActivePage styleMode={styleMode} onToggleStyleMode={toggleStyleMode} />
    </ThemeProvider>
  );
}
