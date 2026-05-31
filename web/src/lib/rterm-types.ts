import type { AppPageId } from '@/app-modules';

export type ProtocolOption = 'SFTP' | 'SCP' | 'FTP' | 'FTPS' | 'WebDAV';
export type TerminalProfile = 'auto' | 'posix' | 'bash' | 'zsh' | 'fish' | 'powershell' | 'cmd';

export type SessionItem = {
  id: string;
  host: string;
  port?: number | null;
  path: string;
  status: 'online' | 'paused' | 'error';
  protocol: ProtocolOption;
  lastSeen: string;
};

export type FavoriteItem = {
  id: string;
  name: string;
  host: string;
  port?: number | null;
  path: string;
  paths?: string[];
  protocol: ProtocolOption;
  username?: string;
  password?: string;
  terminalProfile?: TerminalProfile;
  legacySshHostKeyAlgorithms?: boolean;
};

export type ConnectionDraft = {
  name?: string;
  protocol: ProtocolOption;
  host: string;
  port?: string;
  path: string;
  paths?: string[];
  username?: string;
  password?: string;
  terminalProfile?: TerminalProfile;
  legacySshHostKeyAlgorithms?: boolean;
};

export type RecentConnectionRecord = {
  id: string;
  host: string;
  port?: number | null;
  path: string;
  protocol: ProtocolOption;
  lastConnectedAt: number;
};

export type ConnectionTestResult = {
  protocol: string;
  endpoint: string;
  connected: boolean;
  workingDirectory: string;
  remotePath?: string | null;
};

export type BrowseEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  hidden: boolean;
  size: number;
  modifiedAt?: number | null;
  permissions?: string | null;
};

export type FileMutationScope = 'local' | 'remote';

export type FileMutationResult = {
  path: string;
};

export type FileDigestResult = {
  path: string;
  size: number;
  md5: string;
};

export type FilePreviewResult = {
  path: string;
  name: string;
  size: number;
  kind: 'text' | 'image' | 'pdf' | 'binary';
  content: string | null;
  dataUrl: string | null;
  mimeType: string | null;
  truncated: boolean;
  isBinary: boolean;
};

export type OpenEntryResult = {
  path: string;
  cached: boolean;
};

export type TerminalCommandResult = {
  command: string;
  currentDirectory: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type TerminalHistoryEntry = TerminalCommandResult & {
  id: string;
  ranAt: number;
};

export type TerminalScope = 'local' | 'remote';

export type TerminalSessionInfo = {
  sessionId: string;
  pid?: number | null;
  currentDirectory: string;
  scope: TerminalScope;
  label?: string | null;
};

export type TerminalOutputEvent = {
  sessionId: string;
  chunk: string;
};

export type TerminalExitEvent = {
  sessionId: string;
  exitCode?: number | null;
};

export type TerminalDebugEvent = {
  sessionId: string;
  stage: string;
  message: string;
};

export type RemoteSessionState = {
  key: string;
  protocol: string;
  endpoint: string;
  remotePath?: string | null;
  connected: boolean;
  createdAt: number;
  lastUsedAt: number;
  lastError?: string | null;
};

export type TransferDirection = 'upload' | 'download' | 'remoteCopy';
export type TransferConflictPolicy = 'overwrite' | 'skip' | 'rename';
export type TransferConflictKind = 'existingFile' | 'typeMismatch';

export type TransferStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type TransferRetryPayload = {
  connection: ConnectionDraft;
  targetConnection?: ConnectionDraft;
  localDirectory: string;
  remoteDirectory: string;
  targetRemoteDirectory?: string;
};

export type TransferQueueItem = {
  id: string;
  direction: TransferDirection;
  name: string;
  kind: BrowseEntry['kind'];
  size: number;
  sourcePath: string;
  targetPath: string;
  status: TransferStatus;
  progress: number;
  createdAt: number;
  lastUpdatedAt?: number;
  attemptCount?: number;
  bytesTransferred?: number;
  speedBytesPerSecond?: number;
  filesTransferred?: number;
  skipped?: number;
  renamed?: number;
  currentPath?: string;
  currentFileBytes?: number;
  currentFileTotalBytes?: number | null;
  errorMessage?: string;
  retryPayload?: TransferRetryPayload;
};

export type TransferResult = {
  direction: TransferDirection;
  sourcePath: string;
  targetPath: string;
  bytesTransferred: number;
  filesTransferred: number;
  skipped: number;
  renamed: number;
};

export type TransferConflictItem = {
  sourcePath: string;
  targetPath: string;
  kind: TransferConflictKind;
};

export type TransferProgressEvent = {
  transferId: string;
  direction: TransferDirection;
  sourcePath: string;
  targetPath: string;
  currentPath: string;
  bytesTransferred: number;
  filesTransferred: number;
  skipped: number;
  currentFileBytes: number;
  currentFileTotalBytes?: number | null;
};

export type BrowseListData = {
  source: string;
  endpoint?: string | null;
  directory: string;
  totalEntries: number;
  visibleEntries: number;
  entries: BrowseEntry[];
};

export type SearchMode = 'name' | 'content';

export type SearchTextMatch = {
  entry: BrowseEntry;
  archivePath?: string | null;
  lineNumber: number;
  line: string;
};

export type SearchResultData = {
  source: string;
  endpoint?: string | null;
  directory: string;
  query: string;
  searchMode: SearchMode;
  totalMatches: number;
  capped: boolean;
  entries: BrowseEntry[];
  matches: SearchTextMatch[];
};

export type RuntimeMode = 'live' | 'preview';

export type TimelineItem = {
  id: string;
  title: string;
  detail: string;
  tone: 'info' | 'success' | 'warning' | 'error';
  time: string;
};

export type NavigationState = {
  page: AppPageId;
};

export type WorkbenchState = {
  local: BrowseListData;
  remote: BrowseListData;
  runtimeMode: RuntimeMode;
};
