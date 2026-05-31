import { favorites as previewFavorites, sessions, workbenchColumns } from './rterm-data';
import {
  defaultTerminalCompletionConfig,
  normalizeTerminalCompletionConfig,
  type TerminalCompletionConfigFile,
} from './terminal-completion';
import type {
  BrowseListData,
  ConnectionDraft,
  ConnectionTestResult,
  FileDigestResult,
  FavoriteItem,
  FilePreviewResult,
  FileMutationResult,
  FileMutationScope,
  OpenEntryResult,
  RecentConnectionRecord,
  RemoteSessionState,
  RuntimeMode,
  SearchMode,
  SearchResultData,
  TerminalCommandResult,
  TerminalDebugEvent,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalSessionInfo,
  TransferConflictItem,
  TransferConflictPolicy,
  TransferProgressEvent,
  TransferQueueItem,
  TransferResult,
} from './rterm-types';

type RuntimeResult<T> = {
  data: T;
  runtimeMode: RuntimeMode;
};

type WorkbenchLoadOptions = {
  localPath?: string | null;
  remotePath?: string | null;
  showHidden?: boolean;
};

const RECENT_CONNECTIONS_STORAGE_KEY = 'rterm.recentConnections';
const FAVORITES_STORAGE_KEY = 'rterm.favorites';
const HIDDEN_PREVIEW_FAVORITES_STORAGE_KEY = 'rterm.hiddenPreviewFavorites';
const TERMINAL_COMPLETION_STORAGE_KEY = 'rterm.terminalCompletionConfig';
const DEFAULT_RECENT_CONNECTION_LIMIT = 6;
const DEBUG_REMOTE_HOST = 'debug-r.remote';

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type TauriUnlisten = () => void;
type TauriEventCallback<T> = (event: { payload: T }) => void;
type TauriListen = <T>(event: string, callback: TauriEventCallback<T>) => Promise<TauriUnlisten>;

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke?: TauriInvoke;
      };
      event?: {
        listen?: TauriListen;
      };
    };
  }
}

const protocolScheme: Record<ConnectionDraft['protocol'], string> = {
  SFTP: 'sftp',
  SCP: 'scp',
  FTP: 'ftp',
  FTPS: 'ftps',
  WebDAV: 'https',
};

function connectionPort(draft: ConnectionDraft): number | null {
  const rawPort = draft.port?.trim();
  if (!rawPort) {
    return null;
  }

  const port = Number(rawPort);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function hostHasExplicitPort(host: string): boolean {
  return /:\d+$/.test(host.trim());
}

function getInvoke(): TauriInvoke | null {
  return typeof window !== 'undefined' && typeof window.__TAURI__?.core?.invoke === 'function'
    ? window.__TAURI__.core.invoke
    : null;
}

function getListen(): TauriListen | null {
  return typeof window !== 'undefined' && typeof window.__TAURI__?.event?.listen === 'function'
    ? window.__TAURI__.event.listen
    : null;
}

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readStoredTerminalCompletionConfig(): TerminalCompletionConfigFile {
  const storage = getStorage();
  if (!storage) {
    return {
      path: null,
      config: defaultTerminalCompletionConfig,
    };
  }

  try {
    const stored = storage.getItem(TERMINAL_COMPLETION_STORAGE_KEY);
    return {
      path: 'localStorage:rterm.terminalCompletionConfig',
      config: normalizeTerminalCompletionConfig(stored ? JSON.parse(stored) : defaultTerminalCompletionConfig),
    };
  } catch {
    return {
      path: 'localStorage:rterm.terminalCompletionConfig',
      config: defaultTerminalCompletionConfig,
    };
  }
}

function isDebugRemote(draft: ConnectionDraft): boolean {
  return draft.host.trim() === DEBUG_REMOTE_HOST;
}

function normalizePath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return `/${trimmed.replaceAll('\\', '/')}`;
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function trimPathInput(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function recentConnectionPath(value?: string | null): string {
  return normalizePath(value ?? '') ?? '/';
}

function favoritePathList(draft: Pick<ConnectionDraft, 'path' | 'paths'>): string[] {
  const seen = new Set<string>();
  return [draft.path, ...(draft.paths ?? [])]
    .map((value) => recentConnectionPath(value))
    .filter((path) => {
      if (seen.has(path)) {
        return false;
      }

      seen.add(path);
      return true;
    });
}

function joinPath(base: string, name: string): string {
  if (base === '/' || base === '~') {
    return `${base}/${name}`.replace('//', '/');
  }

  return `${base}/${name}`;
}

function countPathSegment(path: string, segment: string): number {
  return path.split('/').filter((part) => part === segment).length;
}

function resolvePreviewLocalEntries(directory: string): string[] {
  if (directory.endsWith('/src')) {
    return ['app', 'components', 'hooks', 'lib', 'pages', 'theme', 'main.tsx', 'App.tsx', 'styles'];
  }

  if (directory.endsWith('/src/app')) {
    return ['layout.tsx', 'routes.ts', 'providers.tsx'];
  }

  if (directory.endsWith('/core')) {
    return ['browse', 'connections', 'host', 'transfers', 'mod.rs', 'session.rs'];
  }

  if (directory === '~' || directory.endsWith('/Documents')) {
    return ['rterm-workspace', 'archive', 'notes', 'screenshots', 'exports', 'drafts'];
  }

  if (directory.endsWith('/rterm-workspace')) {
    return workbenchColumns.local;
  }

  if (directory.includes('/设计文档')) {
    const depth = countPathSegment(directory, '设计文档');

    if (depth <= 1) {
      return ['产品说明.md', '交互稿.fig', '截图', '归档', '待确认.txt'];
    }

    return ['README.md', 'wireframe.png', 'notes.md'];
  }

  if (directory.endsWith('/screenshots') || directory.endsWith('/截图')) {
    return ['workbench.png', 'connect-panel.png', 'queue-state.png'];
  }

  if (directory.endsWith('/archive') || directory.endsWith('/归档')) {
    return ['2026-04', '2026-03', 'old-notes.md'];
  }

  return workbenchColumns.local;
}

function resolvePreviewRemoteEntries(directory: string): string[] {
  if (directory.endsWith('/releases')) {
    return ['2026-04-23', '2026-04-22', '2026-04-15', 'current', 'rollback'];
  }

  if (directory.endsWith('/logs')) {
    return ['deploy.log', 'sync.log', 'audit.log', 'upload.log', 'cleanup.log'];
  }

  return workbenchColumns.remote;
}

export function buildRemoteSpec(
  draft: ConnectionDraft,
  options: { includePath?: boolean } = {},
): string {
  const rawHost = draft.host.trim();
  const hostWithoutScheme = rawHost.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const username = draft.username?.trim();
  const password = draft.password ?? '';
  const credentials = username ? `${username}${password ? `:${password}` : ''}@` : '';
  const host = credentials ? hostWithoutScheme.split('@').pop() ?? hostWithoutScheme : hostWithoutScheme;
  const port = connectionPort(draft);
  const hostWithPort = port && !hostHasExplicitPort(host) ? `${host}:${port}` : host;
  const path = options.includePath ? normalizePath(draft.path) : null;
  const scheme = protocolScheme[draft.protocol];
  const legacySshOptions =
    draft.legacySshHostKeyAlgorithms && (draft.protocol === 'SFTP' || draft.protocol === 'SCP')
      ? '#rterm-ssh-legacy-host-key=1'
      : '';

  if (draft.protocol === 'WebDAV') {
    const webdavScheme = rawHost.startsWith('http://') ? 'http' : scheme;
    return path
      ? `${webdavScheme}://${credentials}${hostWithPort}${path}`
      : `${webdavScheme}://${credentials}${hostWithPort}`;
  }

  return path
    ? `${scheme}://${credentials}${hostWithPort}:${path}${legacySshOptions}`
    : `${scheme}://${credentials}${hostWithPort}${legacySshOptions}`;
}

function createPreviewConnectionResult(draft: ConnectionDraft): ConnectionTestResult {
  const remotePath = normalizePath(draft.path) ?? '/';

  return {
    protocol: draft.protocol,
    endpoint: draft.host.trim(),
    connected: true,
    workingDirectory: remotePath,
    remotePath,
  };
}

function createPreviewLocalListing(localPath?: string | null): BrowseListData {
  const directory = trimPathInput(localPath) ?? '~/Projects/rterm-workspace';
  const names = resolvePreviewLocalEntries(directory);
  const now = Date.now();

  return {
    source: 'local',
    endpoint: null,
    directory,
    totalEntries: names.length,
    visibleEntries: names.length,
    entries: names.map((name, index) => ({
      name,
      path: joinPath(directory, name),
      kind: name.includes('.') ? 'file' : 'directory',
      hidden: false,
      size: 0,
      modifiedAt: now - index * 43_200_000,
      permissions: name.includes('.') ? '644' : '755',
    })),
  };
}

function createPreviewRemoteListing(
  draft: ConnectionDraft,
  remotePath?: string | null,
): BrowseListData {
  const matchedSession = sessions.find((session) => session.host === draft.host.trim());
  const directory = normalizePath(remotePath ?? draft.path) ?? matchedSession?.path ?? '/';
  const names = resolvePreviewRemoteEntries(directory);
  const now = Date.now() - 1_800_000;

  return {
    source: 'remote',
    endpoint: draft.host.trim(),
    directory,
    totalEntries: names.length,
    visibleEntries: names.length,
    entries: names.map((name, index) => ({
      name,
      path: joinPath(directory, name),
      kind: name.includes('.') ? 'file' : 'directory',
      hidden: false,
      size: 0,
      modifiedAt: now - index * 21_600_000,
      permissions: name.includes('.') ? '644' : '755',
    })),
  };
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .toLocaleLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp(`^${escaped}$|${escaped}`);
}

function isIgnoredSearchEntry(entry: BrowseListData['entries'][number], ignorePatterns: string[]): boolean {
  if (ignorePatterns.length === 0) {
    return false;
  }

  const normalizedName = entry.name.toLocaleLowerCase();
  const normalizedPath = entry.path.replaceAll('\\', '/').toLocaleLowerCase();
  return ignorePatterns.some((pattern) => {
    const matcher = globToRegExp(pattern);
    return matcher.test(normalizedName) || matcher.test(normalizedPath);
  });
}

function createPreviewSearchResults(
  draft: ConnectionDraft,
  scope: FileMutationScope,
  path: string | null | undefined,
  query: string,
  mode: SearchMode,
  showHidden: boolean,
  limit: number,
  targetPaths?: string[],
  ignorePatterns: string[] = [],
): SearchResultData {
  const directory =
    scope === 'local'
      ? trimPathInput(path) ?? '~/Projects/rterm-workspace'
      : normalizePath(path ?? draft.path) ?? '/';
  const listing =
    scope === 'local'
      ? createPreviewLocalListing(directory)
      : createPreviewRemoteListing(draft, directory);
  const previewExtras =
    scope === 'local'
      ? [
          {
            name: 'review-notes.md',
            path: joinPath(joinPath(directory, '设计文档'), 'review-notes.md'),
            kind: 'file' as const,
            hidden: false,
            size: 1280,
            modifiedAt: Date.now() - 86_400_000,
            permissions: '644',
          },
        ]
      : [
          {
            name: 'deploy-review.log',
            path: joinPath(joinPath(directory, 'logs'), 'deploy-review.log'),
            kind: 'file' as const,
            hidden: false,
            size: 4096,
            modifiedAt: Date.now() - 7_200_000,
            permissions: '644',
          },
        ];

  const needle = query.trim().toLocaleLowerCase();
  const searchableEntries = [...listing.entries, ...previewExtras].filter(
    (entry) => (showHidden ? true : !entry.hidden) && !isIgnoredSearchEntry(entry, ignorePatterns),
  );
  const targetSet = new Set((targetPaths ?? []).filter(Boolean));
  const scopedEntries =
    targetSet.size > 0
      ? searchableEntries.filter((entry) => targetSet.has(entry.path) || [...targetSet].some((target) => entry.path.startsWith(`${target}/`)))
      : searchableEntries;
  if (mode === 'content') {
    const fileMatches = scopedEntries
      .filter((entry) => entry.kind === 'file')
      .slice(0, limit)
      .map((entry, index) => ({
        entry,
        lineNumber: 8 + index * 5,
        line: `预览内容中包含 "${query.trim() || 'keyword'}" 的示例匹配行。`,
      }));

    return {
      source: listing.source,
      endpoint: listing.endpoint,
      directory,
      query,
      searchMode: 'content',
      totalMatches: fileMatches.length,
      capped: false,
      entries: fileMatches.map((match) => match.entry),
      matches: fileMatches,
    };
  }

  const matches = scopedEntries
    .filter((entry) => (needle ? entry.name.toLocaleLowerCase().includes(needle) : true))
    .slice(0, limit);

  return {
    source: listing.source,
    endpoint: listing.endpoint,
    directory,
    query,
    searchMode: 'name',
    totalMatches: matches.length,
    capped: false,
    entries: matches,
    matches: [],
  };
}

function normalizeTerminalDirectory(value?: string | null): string {
  return trimPathInput(value) ?? '~/Projects/rterm-workspace';
}

export function supportsRemoteTerminal(draft?: ConnectionDraft | null): boolean {
  return draft?.protocol === 'SFTP' || draft?.protocol === 'SCP';
}

function resolvePreviewTerminalDirectory(directory: string, target: string): string {
  const normalized = target.trim();

  if (!normalized || normalized === '.') {
    return directory;
  }

  if (normalized === '..') {
    return parentPathOf(directory);
  }

  if (normalized === '~' || normalized.startsWith('~/') || normalized.startsWith('/')) {
    return normalized;
  }

  return joinPath(directory, normalized);
}

function createPreviewTerminalResult(
  command: string,
  workingDirectory?: string | null,
): TerminalCommandResult {
  const trimmed = command.trim();
  let currentDirectory = normalizeTerminalDirectory(workingDirectory);
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  if (trimmed === 'pwd') {
    stdout = currentDirectory;
  } else if (trimmed === 'clear') {
    stdout = '';
  } else if (trimmed.startsWith('cd ')) {
    currentDirectory = resolvePreviewTerminalDirectory(currentDirectory, trimmed.slice(3));
  } else if (trimmed === 'ls' || trimmed.startsWith('ls ')) {
    stdout = resolvePreviewLocalEntries(currentDirectory).join('\n');
  } else if (trimmed.startsWith('cat ')) {
    const target = trimmed.slice(4).trim();
    stdout = `[preview] ${target}\n这是终端预览模式下的示例输出。`;
  } else if (trimmed === 'help') {
    stdout = '可用示例命令: pwd, ls, cd <目录>, cat <文件>, clear';
  } else {
    stdout = `[preview] 已执行 ${trimmed}\n当前目录: ${currentDirectory}`;
  }

  return {
    command: trimmed,
    currentDirectory,
    stdout,
    stderr,
    exitCode,
  };
}

function createPreviewFilePreview(
  scope: FileMutationScope,
  path: string,
): FilePreviewResult {
  const name = basenameOf(path);
  const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : '';

  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="860" viewBox="0 0 1280 860" fill="none"><rect width="1280" height="860" rx="36" fill="#121418"/><rect x="84" y="84" width="1112" height="692" rx="28" fill="#181B20" stroke="#2A2F36"/><rect x="156" y="156" width="968" height="548" rx="20" fill="url(#g)"/><circle cx="336" cy="316" r="88" fill="#E9EDF2" fill-opacity=".18"/><path d="M212 588 418 410l148 124 170-188 280 242H212Z" fill="#E9EDF2" fill-opacity=".28"/><text x="156" y="756" fill="#F4F6F8" font-family="SF Pro Display, Arial" font-size="44" font-weight="600">${name}</text><defs><linearGradient id="g" x1="156" y1="156" x2="1124" y2="704" gradientUnits="userSpaceOnUse"><stop stop-color="#2A2F36"/><stop offset="1" stop-color="#1A1E24"/></linearGradient></defs></svg>`;
    return {
      path,
      name,
      size: svg.length,
      kind: 'image',
      content: null,
      dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      mimeType: 'image/svg+xml',
      truncated: false,
      isBinary: false,
    };
  }

  if (extension === 'pdf') {
    return {
      path,
      name,
      size: 0,
      kind: 'pdf',
      content: null,
      dataUrl: null,
      mimeType: 'application/pdf',
      truncated: false,
      isBinary: true,
    };
  }

  if (['zip', 'gz', 'tar'].includes(extension)) {
    return {
      path,
      name,
      size: 0,
      kind: 'binary',
      content: null,
      dataUrl: null,
      mimeType: null,
      truncated: false,
      isBinary: true,
    };
  }

  let content = '';

  if (extension === 'md') {
    content = `# ${name}\n\n- 作用域：${scope === 'local' ? '本地' : '远端'}\n- 当前路径：${path}\n- 状态：预览模式示例\n\n下一步可以继续补编辑入口或外部打开。`;
  } else if (extension === 'log') {
    content = `[2026-04-23 14:08:11] INFO  workbench ready\n[2026-04-23 14:08:17] INFO  preview requested for ${name}\n[2026-04-23 14:08:18] INFO  using browser mock preview`;
  } else if (['ts', 'tsx', 'rs', 'json'].includes(extension)) {
    content = `// Preview mock: ${name}\nexport const previewPath = '${path}';\nexport const previewScope = '${scope}';\n`;
  } else {
    content = `${name}\n\n这是浏览器里的预览样例内容。\n在 Tauri 桌面窗口中，这里会展示文件的真实文本内容。`;
  }

  return {
    path,
    name,
    size: content.length,
    kind: 'text',
    content,
    dataUrl: null,
    mimeType: 'text/plain',
    truncated: false,
    isBinary: false,
  };
}

function formatRuntimeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return '发生了未识别的运行时错误。';
}

function recentConnectionId(draft: ConnectionDraft, resolvedPath?: string): string {
  const port = connectionPort(draft);
  return `${draft.protocol}:${draft.host.trim()}:${port ?? ''}:${recentConnectionPath(resolvedPath ?? draft.path)}`;
}

function buildRecentConnectionRecord(
  draft: ConnectionDraft,
  resolvedPath?: string,
): RecentConnectionRecord {
  return {
    id: recentConnectionId(draft, resolvedPath),
    host: draft.host.trim(),
    port: connectionPort(draft),
    path: recentConnectionPath(resolvedPath ?? draft.path),
    protocol: draft.protocol,
    lastConnectedAt: Date.now(),
  };
}

function readStoredRecentConnections(): RecentConnectionRecord[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(RECENT_CONNECTIONS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const records = JSON.parse(raw) as RecentConnectionRecord[];
    return records
      .filter((record) => record?.id && record?.host && record?.protocol)
      .sort((left, right) => right.lastConnectedAt - left.lastConnectedAt);
  } catch {
    return [];
  }
}

function writeStoredRecentConnections(records: RecentConnectionRecord[]) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(RECENT_CONNECTIONS_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage failures during preview mode.
  }
}

function readStoredFavorites(): FavoriteItem[] {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  try {
    const raw = storage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    return (JSON.parse(raw) as FavoriteItem[])
      .filter((item) => item?.id && item?.host && item?.path && item?.protocol)
      .map((item) => ({
        ...item,
        paths: favoritePathList(item),
      }));
  } catch {
    return [];
  }
}

function readHiddenPreviewFavoriteKeys(): Set<string> {
  const storage = getStorage();
  if (!storage) {
    return new Set();
  }

  try {
    const raw = storage.getItem(HIDDEN_PREVIEW_FAVORITES_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }

    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

function hidePreviewFavorite(id: string) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const hidden = readHiddenPreviewFavoriteKeys();
  const previewFavorite = previewFavorites.find((record) => record.id === id);
  if (!previewFavorite) {
    return;
  }

  hidden.add(previewFavorite.id);
  hidden.add(previewFavorite.host);
  try {
    storage.setItem(HIDDEN_PREVIEW_FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(hidden)));
  } catch {
    // Hiding a preview favorite is a UI preference; storage failures should not block removal.
  }
}

function visiblePreviewFavorites(): FavoriteItem[] {
  const hiddenPreviewFavorites = readHiddenPreviewFavoriteKeys();
  return previewFavorites
    .filter((record) => !hiddenPreviewFavorites.has(record.id) && !hiddenPreviewFavorites.has(record.host))
    .map((record) => ({
      ...record,
      paths: favoritePathList(record),
      terminalProfile: record.terminalProfile ?? 'auto',
    }));
}

function withPreviewDebugFavorite(records: FavoriteItem[]): FavoriteItem[] {
  const normalizedRecords = records.map((record) => ({
    ...record,
    paths: favoritePathList(record),
    terminalProfile: record.terminalProfile ?? 'auto',
  }));
  const debugFavorite = previewFavorites[0]
    ? {
        ...previewFavorites[0],
        paths: favoritePathList(previewFavorites[0]),
        terminalProfile: previewFavorites[0].terminalProfile ?? 'auto',
      }
    : null;
  const hiddenPreviewFavorites = readHiddenPreviewFavoriteKeys();
  if (
    !debugFavorite ||
    hiddenPreviewFavorites.has(debugFavorite.id) ||
    hiddenPreviewFavorites.has(debugFavorite.host) ||
    normalizedRecords.some((record) => record.id === debugFavorite.id || record.host === debugFavorite.host)
  ) {
    return normalizedRecords;
  }

  return [debugFavorite, ...normalizedRecords];
}

function writeStoredFavorites(records: FavoriteItem[]) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Ignore storage failures during preview mode.
  }
}

function mergeRecentConnections(
  current: RecentConnectionRecord[],
  nextRecord: RecentConnectionRecord,
  limit: number,
) {
  return [nextRecord, ...current.filter((record) => record.id !== nextRecord.id)].slice(0, limit);
}

function inferFavoriteName(draft: ConnectionDraft) {
  const explicitName = draft.name?.trim();
  if (explicitName) {
    return explicitName;
  }

  const fallback = recentConnectionPath(draft.path)
    .split('/')
    .filter(Boolean)
    .pop();

  return `常用 · ${fallback ?? draft.host.trim()}`;
}

function buildFavoriteRecord(draft: ConnectionDraft, name?: string): FavoriteItem {
  return {
    id: recentConnectionId(draft),
    name: name?.trim() || inferFavoriteName(draft),
    host: draft.host.trim(),
    port: connectionPort(draft),
    path: recentConnectionPath(draft.path),
    paths: favoritePathList(draft),
    protocol: draft.protocol,
    username: draft.username?.trim() || undefined,
    password: draft.password?.trim() || undefined,
    terminalProfile: draft.terminalProfile ?? 'auto',
    legacySshHostKeyAlgorithms: draft.legacySshHostKeyAlgorithms || undefined,
  };
}

function mergeFavorites(current: FavoriteItem[], nextRecord: FavoriteItem) {
  return [nextRecord, ...current.filter((record) => record.id !== nextRecord.id)];
}

export async function loadRecentConnections(
  limit = DEFAULT_RECENT_CONNECTION_LIMIT,
): Promise<RuntimeResult<RecentConnectionRecord[]>> {
  const invoke = getInvoke();

  if (!invoke) {
    return {
      data: readStoredRecentConnections().slice(0, limit),
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: await invoke<RecentConnectionRecord[]>('list_recent_connections', { limit }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function rememberRecentConnection(
  draft: ConnectionDraft,
  resolvedPath?: string,
  limit = DEFAULT_RECENT_CONNECTION_LIMIT,
): Promise<RuntimeResult<RecentConnectionRecord[]>> {
  const invoke = getInvoke();

  if (!invoke) {
    const nextRecord = buildRecentConnectionRecord(draft, resolvedPath);
    const merged = mergeRecentConnections(readStoredRecentConnections(), nextRecord, limit);
    writeStoredRecentConnections(merged);

    return {
      data: merged,
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: await invoke<RecentConnectionRecord[]>('remember_recent_connection', {
        host: draft.host.trim(),
        port: connectionPort(draft),
        path: recentConnectionPath(resolvedPath ?? draft.path),
        protocol: draft.protocol,
        limit,
      }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function removeRecentConnection(
  id: string,
  limit = DEFAULT_RECENT_CONNECTION_LIMIT,
): Promise<RuntimeResult<RecentConnectionRecord[]>> {
  const invoke = getInvoke();

  if (!invoke) {
    const filtered = readStoredRecentConnections()
      .filter((record) => record.id !== id)
      .slice(0, limit);
    writeStoredRecentConnections(filtered);

    return {
      data: filtered,
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: await invoke<RecentConnectionRecord[]>('remove_recent_connection', {
        id,
        limit,
      }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function loadFavorites(): Promise<RuntimeResult<FavoriteItem[]>> {
  const invoke = getInvoke();

  if (!invoke) {
    const stored = readStoredFavorites();
    return {
      data: stored.length > 0 ? withPreviewDebugFavorite(stored) : visiblePreviewFavorites(),
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: withPreviewDebugFavorite(await invoke<FavoriteItem[]>('list_favorites')),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function loadTerminalCompletionConfig(): Promise<RuntimeResult<TerminalCompletionConfigFile>> {
  const invoke = getInvoke();

  if (!invoke) {
    return {
      data: readStoredTerminalCompletionConfig(),
      runtimeMode: 'preview',
    };
  }

  try {
    const result = await invoke<TerminalCompletionConfigFile>('load_terminal_completion_config');
    return {
      data: {
        path: result.path,
        config: normalizeTerminalCompletionConfig(result.config),
      },
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function loadFavoritePassword(id: string): Promise<RuntimeResult<string | null>> {
  const invoke = getInvoke();

  if (!invoke) {
    const password = readStoredFavorites().find((record) => record.id === id)?.password ?? null;
    return {
      data: password,
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: await invoke<string | null>('load_favorite_password', { id }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function saveFavorite(
  draft: ConnectionDraft,
  name?: string,
): Promise<RuntimeResult<FavoriteItem[]>> {
  const invoke = getInvoke();

  if (!invoke) {
    const nextRecord = buildFavoriteRecord(draft, name);
    const merged = mergeFavorites(readStoredFavorites(), nextRecord);
    writeStoredFavorites(merged);

    return {
      data: withPreviewDebugFavorite(merged),
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: withPreviewDebugFavorite(
        await invoke<FavoriteItem[]>('save_favorite', {
          name: name?.trim() || draft.name?.trim() || inferFavoriteName(draft),
          host: draft.host.trim(),
          port: connectionPort(draft),
          path: recentConnectionPath(draft.path),
          paths: favoritePathList(draft),
          protocol: draft.protocol,
          username: draft.username?.trim() || null,
          password: draft.password?.trim() || null,
          terminal_profile: draft.terminalProfile ?? 'auto',
          legacy_ssh_host_key_algorithms: draft.legacySshHostKeyAlgorithms ?? false,
        }),
      ),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function removeFavorite(id: string): Promise<RuntimeResult<FavoriteItem[]>> {
  const invoke = getInvoke();
  hidePreviewFavorite(id);

  if (!invoke) {
    const storedFavorites = readStoredFavorites();
    const filtered = storedFavorites.filter((record) => record.id !== id);
    writeStoredFavorites(filtered);

    return {
      data: storedFavorites.length > 0 ? withPreviewDebugFavorite(filtered) : visiblePreviewFavorites(),
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: withPreviewDebugFavorite(await invoke<FavoriteItem[]>('remove_favorite', { id })),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function renameFavorite(
  id: string,
  name: string,
): Promise<RuntimeResult<FavoriteItem[]>> {
  const invoke = getInvoke();
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error('收藏名称不能为空。');
  }

  if (!invoke) {
    const renamed = readStoredFavorites().map((record) =>
      record.id === id ? { ...record, name: trimmedName } : record,
    );
    writeStoredFavorites(renamed);

    return {
      data: withPreviewDebugFavorite(renamed),
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: withPreviewDebugFavorite(
        await invoke<FavoriteItem[]>('rename_favorite', {
          id,
          name: trimmedName,
        }),
      ),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function testConnection(
  draft: ConnectionDraft,
): Promise<RuntimeResult<ConnectionTestResult>> {
  const invoke = getInvoke();

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: createPreviewConnectionResult(draft),
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: await invoke<ConnectionTestResult>('test_connection', {
        remote: buildRemoteSpec(draft, { includePath: true }),
      }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function listRemoteSessionStates(): Promise<RuntimeResult<RemoteSessionState[]>> {
  const invoke = getInvoke();

  if (!invoke) {
    return {
      data: [],
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: await invoke<RemoteSessionState[]>('list_remote_session_states'),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function disconnectRemoteSession(remote: string): Promise<void> {
  const invoke = getInvoke();

  if (!invoke) {
    return;
  }

  await invoke('disconnect_remote_session', { remote });
}

export async function loadWorkbench(
  draft: ConnectionDraft,
  options: WorkbenchLoadOptions = {},
): Promise<RuntimeResult<{ local: BrowseListData; remote: BrowseListData }>> {
  const invoke = getInvoke();

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: {
        local: createPreviewLocalListing(options.localPath),
        remote: createPreviewRemoteListing(draft, options.remotePath),
      },
      runtimeMode: 'preview',
    };
  }

  try {
    const localPath = trimPathInput(options.localPath);
    const remotePath = normalizePath(options.remotePath ?? draft.path);
    const showHidden = options.showHidden ?? false;
    const [local, remote] = await Promise.all([
      invoke<BrowseListData>('browse_local', {
        path: localPath,
        show_hidden: showHidden,
      }),
      invoke<BrowseListData>('browse_remote', {
        remote: buildRemoteSpec(draft),
        path: remotePath,
        show_hidden: showHidden,
      }),
    ]);

    return {
      data: { local, remote },
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function browseLocalDirectory(
  path?: string | null,
  showHidden = false,
): Promise<RuntimeResult<BrowseListData>> {
  const invoke = getInvoke();
  const localPath = trimPathInput(path);

  if (!invoke) {
    return {
      data: createPreviewLocalListing(localPath),
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: await invoke<BrowseListData>('browse_local', {
        path: localPath,
        show_hidden: showHidden,
      }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function browseRemoteDirectory(
  draft: ConnectionDraft,
  path?: string | null,
  showHidden = false,
): Promise<RuntimeResult<BrowseListData>> {
  const invoke = getInvoke();
  const remotePath = normalizePath(path ?? draft.path);

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: createPreviewRemoteListing(draft, remotePath),
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: await invoke<BrowseListData>('browse_remote', {
        remote: buildRemoteSpec(draft),
        path: remotePath,
        show_hidden: showHidden,
      }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function createDirectory(
  draft: ConnectionDraft,
  scope: FileMutationScope,
  directory: string,
  name: string,
): Promise<RuntimeResult<FileMutationResult>> {
  const invoke = getInvoke();

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: {
        path: joinPath(directory, name.trim()),
      },
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data:
        scope === 'local'
          ? await invoke<FileMutationResult>('create_local_directory', {
              directory,
              name,
            })
          : await invoke<FileMutationResult>('create_remote_directory', {
              remote: buildRemoteSpec(draft),
              directory,
              name,
            }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function copyEntry(
  draft: ConnectionDraft,
  scope: FileMutationScope,
  path: string,
  destination: string,
): Promise<RuntimeResult<FileMutationResult>> {
  const invoke = getInvoke();

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: {
        path: destination.trim() || path,
      },
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data:
        scope === 'local'
          ? await invoke<FileMutationResult>('copy_local_entry', {
              path,
              destination,
            })
          : await invoke<FileMutationResult>('copy_remote_entry', {
              remote: buildRemoteSpec(draft),
              path,
              destination,
            }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function chmodEntry(
  draft: ConnectionDraft,
  scope: FileMutationScope,
  path: string,
  mode: string,
): Promise<RuntimeResult<FileMutationResult>> {
  const invoke = getInvoke();

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: {
        path,
      },
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data:
        scope === 'local'
          ? await invoke<FileMutationResult>('chmod_local_entry', {
              path,
              mode,
            })
          : await invoke<FileMutationResult>('chmod_remote_entry', {
              remote: buildRemoteSpec(draft),
              path,
              mode,
            }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function calculateMd5(
  draft: ConnectionDraft,
  scope: FileMutationScope,
  path: string,
): Promise<RuntimeResult<FileDigestResult>> {
  const invoke = getInvoke();

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: {
        path,
        size: 0,
        md5: 'd41d8cd98f00b204e9800998ecf8427e',
      },
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data:
        scope === 'local'
          ? await invoke<FileDigestResult>('md5_local_file', {
              path,
            })
          : await invoke<FileDigestResult>('md5_remote_file', {
              remote: buildRemoteSpec(draft),
              path,
            }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function moveEntry(
  draft: ConnectionDraft,
  scope: FileMutationScope,
  path: string,
  destination: string,
): Promise<RuntimeResult<FileMutationResult>> {
  const invoke = getInvoke();

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: {
        path: destination.trim() || path,
      },
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data:
        scope === 'local'
          ? await invoke<FileMutationResult>('move_local_entry', {
              path,
              destination,
            })
          : await invoke<FileMutationResult>('move_remote_entry', {
              remote: buildRemoteSpec(draft),
              path,
              destination,
            }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function searchEntries(
  draft: ConnectionDraft,
  scope: FileMutationScope,
  path: string,
  query: string,
  mode: SearchMode = 'name',
  showHidden = false,
  limit = 200,
  targetPaths?: string[],
  searchId?: string,
  ignorePatterns?: string[],
): Promise<RuntimeResult<SearchResultData>> {
  const invoke = getInvoke();

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: createPreviewSearchResults(
        draft,
        scope,
        path,
        query,
        mode,
        showHidden,
        limit,
        targetPaths,
        ignorePatterns,
      ),
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data:
        scope === 'local'
          ? await invoke<SearchResultData>('search_local', {
              path,
              paths: targetPaths,
              query,
              mode,
              show_hidden: showHidden,
              limit,
              searchId,
              ignorePatterns,
            })
          : await invoke<SearchResultData>('search_remote', {
              remote: buildRemoteSpec(draft),
              path,
              paths: targetPaths,
              query,
              mode,
              show_hidden: showHidden,
              limit,
              searchId,
              ignorePatterns,
            }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function cancelSearch(searchId: string): Promise<void> {
  const invoke = getInvoke();

  if (!invoke) {
    return;
  }

  await invoke('cancel_search', { searchId });
}

export async function renameEntry(
  draft: ConnectionDraft,
  scope: FileMutationScope,
  path: string,
  name: string,
): Promise<RuntimeResult<FileMutationResult>> {
  const invoke = getInvoke();
  const trimmedName = name.trim();

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: {
        path: joinPath(parentPathOf(path), trimmedName),
      },
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data:
        scope === 'local'
          ? await invoke<FileMutationResult>('rename_local_entry', {
              path,
              name,
            })
          : await invoke<FileMutationResult>('rename_remote_entry', {
              remote: buildRemoteSpec(draft),
              path,
              name,
            }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function deleteEntry(
  draft: ConnectionDraft,
  scope: FileMutationScope,
  path: string,
): Promise<RuntimeResult<FileMutationResult>> {
  const invoke = getInvoke();

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: { path },
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data:
        scope === 'local'
          ? await invoke<FileMutationResult>('delete_local_entry', {
              path,
            })
          : await invoke<FileMutationResult>('delete_remote_entry', {
              remote: buildRemoteSpec(draft),
              path,
            }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function loadFilePreview(
  draft: ConnectionDraft,
  scope: FileMutationScope,
  path: string,
): Promise<RuntimeResult<FilePreviewResult>> {
  const invoke = getInvoke();

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: createPreviewFilePreview(scope, path),
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data:
        scope === 'local'
          ? await invoke<FilePreviewResult>('preview_local_file', {
              path,
            })
          : await invoke<FilePreviewResult>('preview_remote_file', {
              remote: buildRemoteSpec(draft),
              path,
            }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function saveTextFile(
  draft: ConnectionDraft,
  scope: FileMutationScope,
  path: string,
  content: string,
): Promise<RuntimeResult<FileMutationResult>> {
  const invoke = getInvoke();

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: { path },
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data:
        scope === 'local'
          ? await invoke<FileMutationResult>('save_local_text_file', {
              path,
              content,
            })
          : await invoke<FileMutationResult>('save_remote_text_file', {
              remote: buildRemoteSpec(draft),
              path,
              content,
            }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function openEntry(
  draft: ConnectionDraft,
  scope: FileMutationScope,
  path: string,
): Promise<RuntimeResult<OpenEntryResult>> {
  const invoke = getInvoke();

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: {
        path,
        cached: scope === 'remote',
      },
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data:
        scope === 'local'
          ? await invoke<OpenEntryResult>('open_local_entry', {
              path,
            })
          : await invoke<OpenEntryResult>('open_remote_entry', {
              remote: buildRemoteSpec(draft),
              path,
            }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function runLocalTerminalCommand(
  command: string,
  workingDirectory?: string | null,
): Promise<RuntimeResult<TerminalCommandResult>> {
  const invoke = getInvoke();

  if (!invoke) {
    return {
      data: createPreviewTerminalResult(command, workingDirectory),
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: await invoke<TerminalCommandResult>('run_local_terminal_command', {
        command,
        working_directory: workingDirectory ?? null,
      }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function runRemoteTerminalCommand(
  draft: ConnectionDraft,
  command: string,
  workingDirectory?: string | null,
): Promise<RuntimeResult<TerminalCommandResult>> {
  const invoke = getInvoke();

  if (!invoke) {
    return {
      data: createPreviewTerminalResult(command, workingDirectory ?? draft.path),
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: await invoke<TerminalCommandResult>('run_remote_terminal_command', {
        remote: buildRemoteSpec(draft),
        command,
        working_directory: workingDirectory ?? null,
      }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function startLocalTerminalSession(
  workingDirectory?: string | null,
  size?: { rows?: number; cols?: number },
): Promise<RuntimeResult<TerminalSessionInfo>> {
  const invoke = getInvoke();

  if (!invoke) {
    return {
      data: {
        sessionId: `preview-terminal-${Date.now()}`,
        pid: null,
        currentDirectory: normalizeTerminalDirectory(workingDirectory),
        scope: 'local',
        label: '本地 Shell',
      },
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: await invoke<TerminalSessionInfo>('start_local_terminal_session', {
        working_directory: workingDirectory ?? null,
        rows: size?.rows ?? 24,
        cols: size?.cols ?? 100,
      }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function startRemoteTerminalSession(
  draft: ConnectionDraft,
  workingDirectory?: string | null,
  size?: { rows?: number; cols?: number },
): Promise<RuntimeResult<TerminalSessionInfo>> {
  const invoke = getInvoke();
  const label = `${draft.username?.trim() ? `${draft.username.trim()}@` : ''}${draft.host.trim()}${
    draft.port?.trim() ? `:${draft.port.trim()}` : ''
  }`;

  if (!invoke) {
    return {
      data: {
        sessionId: `preview-remote-terminal-${Date.now()}`,
        pid: null,
        currentDirectory: normalizePath(workingDirectory ?? draft.path) ?? '/',
        scope: 'remote',
        label,
      },
      runtimeMode: 'preview',
    };
  }

  try {
    return {
      data: await invoke<TerminalSessionInfo>('start_remote_terminal_session', {
        remote: buildRemoteSpec(draft),
        working_directory: workingDirectory ?? null,
        rows: size?.rows ?? 24,
        cols: size?.cols ?? 100,
      }),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function writeTerminalInput(sessionId: string, input: string): Promise<void> {
  const invoke = getInvoke();

  if (!invoke) {
    return;
  }

  try {
    await invoke('write_terminal_input', {
      sessionId,
      input,
    });
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function resizeTerminalSession(
  sessionId: string,
  size: { rows: number; cols: number },
): Promise<void> {
  const invoke = getInvoke();

  if (!invoke) {
    return;
  }

  await invoke('resize_terminal_session', {
    sessionId,
    rows: size.rows,
    cols: size.cols,
  });
}

export async function closeTerminalSession(sessionId: string): Promise<void> {
  const invoke = getInvoke();

  if (!invoke) {
    return;
  }

  await invoke('close_terminal_session', {
    sessionId,
  });
}

export async function executeTransfer(
  draft: ConnectionDraft,
  item: TransferQueueItem,
  conflictPolicy: TransferConflictPolicy = 'overwrite',
  targetDraft?: ConnectionDraft,
): Promise<RuntimeResult<TransferResult>> {
  const invoke = getInvoke();

  if (!invoke || isDebugRemote(draft)) {
    return {
      data: {
        direction: item.direction,
        sourcePath: item.sourcePath,
        targetPath: item.targetPath,
        bytesTransferred: item.size,
        filesTransferred: 1,
        skipped: 0,
        renamed: conflictPolicy === 'rename' ? 1 : 0,
      },
      runtimeMode: 'preview',
    };
  }

  const remote = buildRemoteSpec(draft);
  const targetRemote = targetDraft ? buildRemoteSpec(targetDraft) : null;
  const command =
    item.direction === 'upload'
      ? 'upload_path'
      : item.direction === 'download'
        ? 'download_path'
        : 'copy_remote_path';
  const args =
    item.direction === 'upload'
      ? {
          transferId: item.id,
          conflictPolicy,
          remote,
          localPath: item.sourcePath,
          remotePath: item.targetPath,
        }
      : item.direction === 'download'
        ? {
            transferId: item.id,
            conflictPolicy,
            remote,
            remotePath: item.sourcePath,
            localPath: item.targetPath,
          }
        : targetRemote
          ? {
              transferId: item.id,
              conflictPolicy,
              sourceRemote: remote,
              sourcePath: item.sourcePath,
              targetRemote,
              targetPath: item.targetPath,
            }
          : null;

  if (!args) {
    throw new Error('缺少目标远端连接，无法执行远端复制。');
  }

  try {
    return {
      data: await invoke<TransferResult>(command, args),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

function parentPathOf(path: string): string {
  if (path === '/' || path === '~') {
    return path;
  }

  const trimmed = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
  const index = trimmed.lastIndexOf('/');

  if (index <= 0) {
    return trimmed.startsWith('~/') ? '~' : '/';
  }

  return trimmed.slice(0, index);
}

function basenameOf(path: string): string {
  const trimmed = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path;
  const index = trimmed.lastIndexOf('/');
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

function previewTargetExists(scope: 'local' | 'remote', targetPath: string): boolean {
  const directory = parentPathOf(targetPath);
  const name = basenameOf(targetPath);
  const entries =
    scope === 'local' ? resolvePreviewLocalEntries(directory) : resolvePreviewRemoteEntries(directory);

  return entries.includes(name);
}

export async function inspectTransferConflicts(
  draft: ConnectionDraft,
  item: TransferQueueItem,
  targetDraft?: ConnectionDraft,
): Promise<RuntimeResult<TransferConflictItem[]>> {
  const invoke = getInvoke();

  if (!invoke || isDebugRemote(draft)) {
    if (item.direction === 'remoteCopy') {
      return {
        data: [],
        runtimeMode: 'preview',
      };
    }

    const exists = previewTargetExists(item.direction === 'upload' ? 'remote' : 'local', item.targetPath);

    return {
      data: exists
        ? [
            {
              sourcePath: item.sourcePath,
              targetPath: item.targetPath,
              kind: 'existingFile',
            },
          ]
        : [],
      runtimeMode: 'preview',
    };
  }

  const remote = buildRemoteSpec(draft);
  const targetRemote = targetDraft ? buildRemoteSpec(targetDraft) : null;
  const command =
    item.direction === 'upload'
      ? 'inspect_upload_conflicts'
      : item.direction === 'download'
        ? 'inspect_download_conflicts'
        : 'inspect_remote_copy_conflicts';
  const args =
    item.direction === 'upload'
      ? {
          remote,
          localPath: item.sourcePath,
          remotePath: item.targetPath,
        }
      : item.direction === 'download'
        ? {
            remote,
            remotePath: item.sourcePath,
            localPath: item.targetPath,
          }
        : targetRemote
          ? {
              sourceRemote: remote,
              sourcePath: item.sourcePath,
              targetRemote,
              targetPath: item.targetPath,
            }
          : null;

  if (!args) {
    throw new Error('缺少目标远端连接，无法检查远端复制冲突。');
  }

  try {
    return {
      data: await invoke<TransferConflictItem[]>(command, args),
      runtimeMode: 'live',
    };
  } catch (error) {
    throw new Error(formatRuntimeError(error));
  }
}

export async function subscribeTransferProgress(
  listener: (event: TransferProgressEvent) => void,
): Promise<() => void> {
  const listen = getListen();

  if (!listen) {
    return () => undefined;
  }

  return listen<TransferProgressEvent>('transfer-progress', (event) => {
    listener(event.payload);
  });
}

export async function subscribeTerminalOutput(
  listener: (event: TerminalOutputEvent) => void,
): Promise<() => void> {
  const listen = getListen();

  if (!listen) {
    return () => undefined;
  }

  return listen<TerminalOutputEvent>('terminal-output', (event) => {
    listener(event.payload);
  });
}

export async function subscribeTerminalExit(
  listener: (event: TerminalExitEvent) => void,
): Promise<() => void> {
  const listen = getListen();

  if (!listen) {
    return () => undefined;
  }

  return listen<TerminalExitEvent>('terminal-exit', (event) => {
    listener(event.payload);
  });
}

export async function subscribeTerminalDebug(
  listener: (event: TerminalDebugEvent) => void,
): Promise<() => void> {
  const listen = getListen();

  if (!listen) {
    return () => undefined;
  }

  return listen<TerminalDebugEvent>('terminal-debug', (event) => {
    listener(event.payload);
  });
}

export async function cancelTransfer(transferId: string): Promise<void> {
  const invoke = getInvoke();

  if (!invoke) {
    return;
  }

  await invoke('cancel_transfer', { transferId });
}
