import { useEffect, useRef, useState } from 'react';
import { subscribeTransferProgress } from '@/lib/rterm-runtime';
import type {
  BrowseEntry,
  ConnectionDraft,
  ProtocolOption,
  TerminalProfile,
  TransferDirection,
  TransferProgressEvent,
  TransferQueueItem,
  TransferRetryPayload,
  TransferStatus,
} from '@/lib/rterm-types';

const TRANSFER_QUEUE_LIMIT = 100;
const TRANSFER_QUEUE_STORAGE_KEY = 'rterm.transferQueue.v1';
const TRANSFER_QUEUE_STORAGE_VERSION = 1;

type StoredTransferQueue = {
  version: typeof TRANSFER_QUEUE_STORAGE_VERSION;
  items: TransferQueueItem[];
};

export function joinTransferPath(directory: string, name: string): string {
  if (directory === '/' || directory === '~') {
    return `${directory}/${name}`.replace('//', '/');
  }

  return `${directory}/${name}`;
}

export function createTransferId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createTransferQueueItem(
  direction: TransferDirection,
  entry: BrowseEntry,
  targetDirectory: string,
  retryPayload: TransferRetryPayload,
): TransferQueueItem {
  return {
    id: createTransferId(),
    direction,
    name: entry.name,
    kind: entry.kind,
    size: entry.size,
    sourcePath: entry.path,
    targetPath: joinTransferPath(targetDirectory, entry.name),
    status: 'queued',
    progress: 0,
    createdAt: Date.now(),
    lastUpdatedAt: Date.now(),
    attemptCount: 1,
    retryPayload,
  };
}

export function upsertTransferQueueItem(current: TransferQueueItem[], next: TransferQueueItem): TransferQueueItem[] {
  return [next, ...current.filter((entry) => entry.id !== next.id)].slice(0, TRANSFER_QUEUE_LIMIT);
}

export function deriveTransferProgress(item: TransferQueueItem, event: TransferProgressEvent): number {
  if (item.size > 0) {
    return Math.max(10, Math.min(96, Math.round((event.bytesTransferred / item.size) * 100)));
  }

  if (event.currentFileTotalBytes && event.currentFileTotalBytes > 0) {
    return Math.max(10, Math.min(92, Math.round((event.currentFileBytes / event.currentFileTotalBytes) * 100)));
  }

  if (event.bytesTransferred > 0 || event.filesTransferred > 0) {
    return 68;
  }

  return 8;
}

export function deriveTransferSpeed(
  previousItem: TransferQueueItem,
  nextBytesTransferred: number,
  nextUpdatedAt: number,
): number | undefined {
  const previousUpdatedAt = previousItem.lastUpdatedAt;
  if (!previousUpdatedAt || nextUpdatedAt <= previousUpdatedAt) {
    return previousItem.speedBytesPerSecond;
  }

  const deltaBytes = Math.max(0, nextBytesTransferred - (previousItem.bytesTransferred ?? 0));
  const deltaMs = nextUpdatedAt - previousUpdatedAt;
  if (deltaBytes <= 0 || deltaMs < 160) {
    return previousItem.speedBytesPerSecond;
  }

  const instantaneousSpeed = deltaBytes / (deltaMs / 1000);
  if (!Number.isFinite(instantaneousSpeed) || instantaneousSpeed <= 0) {
    return previousItem.speedBytesPerSecond;
  }

  if (previousItem.speedBytesPerSecond && previousItem.speedBytesPerSecond > 0) {
    return previousItem.speedBytesPerSecond * 0.58 + instantaneousSpeed * 0.42;
  }

  return instantaneousSpeed;
}

export function isTransferCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase();

  return (
    message.includes('transfer cancelled') ||
    message.includes('transfer canceled') ||
    message.includes('传输已取消')
  );
}

export function transferCompletionDetail(sourceName: string, item: TransferQueueItem): string {
  const renamed = item.renamed ?? 0;
  const skipped = item.skipped ?? 0;
  const transferred = item.filesTransferred ?? 0;

  if (skipped > 0 && transferred === 0 && renamed === 0) {
    return `${sourceName} 未变化或有冲突，已跳过。`;
  }

  if (renamed > 0 && skipped > 0) {
    return `${sourceName} 已完成，重命名 ${renamed} 项，跳过 ${skipped} 项。`;
  }

  if (renamed > 0) {
    return `${sourceName} 已完成，重命名 ${renamed} 项。`;
  }

  if (skipped > 0) {
    return `${sourceName} 已完成，跳过 ${skipped} 项。`;
  }

  return `${sourceName} 已完成。`;
}

export function useTransferQueue() {
  const [transferQueue, setTransferQueue] = useState<TransferQueueItem[]>(readStoredTransferQueue);
  const cancelledTransferIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    writeStoredTransferQueue(transferQueue);
  }, [transferQueue]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void subscribeTransferProgress((event) => {
      setTransferQueue((current) =>
        current.map((item) =>
          item.id === event.transferId
            ? (() => {
                if (cancelledTransferIdsRef.current.has(item.id) || item.status === 'cancelled') {
                  return item;
                }

                const now = Date.now();
                return {
                  ...item,
                  status: 'running',
                  progress: Math.max(item.progress, deriveTransferProgress(item, event)),
                  bytesTransferred: event.bytesTransferred,
                  speedBytesPerSecond: deriveTransferSpeed(item, event.bytesTransferred, now),
                  filesTransferred: event.filesTransferred,
                  skipped: event.skipped,
                  currentPath: event.currentPath,
                  currentFileBytes: event.currentFileBytes,
                  currentFileTotalBytes: event.currentFileTotalBytes,
                  lastUpdatedAt: now,
                };
              })()
            : item,
        ),
      );
    }).then((disposeListener) => {
      if (disposed) {
        disposeListener();
        return;
      }

      unlisten = disposeListener;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return {
    transferQueue,
    setTransferQueue,
    cancelledTransferIdsRef,
  };
}

function readStoredTransferQueue(): TransferQueueItem[] {
  try {
    const raw = window.localStorage.getItem(TRANSFER_QUEUE_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    const rawItems = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && parsed.version === TRANSFER_QUEUE_STORAGE_VERSION && Array.isArray(parsed.items)
        ? parsed.items
        : [];

    return restorePersistedTransferQueue(normalizeTransferQueue(rawItems));
  } catch {
    return [];
  }
}

function writeStoredTransferQueue(items: TransferQueueItem[]) {
  try {
    const payload: StoredTransferQueue = {
      version: TRANSFER_QUEUE_STORAGE_VERSION,
      items: normalizeTransferQueue(items),
    };
    window.localStorage.setItem(TRANSFER_QUEUE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Transfer history is a convenience cache; storage failures should not block transfers.
  }
}

function restorePersistedTransferQueue(items: TransferQueueItem[]): TransferQueueItem[] {
  const now = Date.now();

  return items.map((item) =>
    item.status === 'running'
      ? {
          ...item,
          status: 'failed',
          progress: Math.max(item.progress, 8),
          lastUpdatedAt: now,
          errorMessage: '应用关闭前传输未完成，可重试该任务。',
        }
      : item,
  );
}

function normalizeTransferQueue(value: unknown): TransferQueueItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeTransferQueueItem)
    .filter((item): item is TransferQueueItem => item !== null)
    .sort((left, right) => (right.lastUpdatedAt ?? right.createdAt) - (left.lastUpdatedAt ?? left.createdAt))
    .slice(0, TRANSFER_QUEUE_LIMIT);
}

function normalizeTransferQueueItem(value: unknown): TransferQueueItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringValue(value.id);
  const direction = transferDirection(value.direction);
  const name = stringValue(value.name);
  const kind = browseEntryKind(value.kind);
  const sourcePath = stringValue(value.sourcePath);
  const targetPath = stringValue(value.targetPath);
  const status = transferStatus(value.status);
  const createdAt = finiteNumber(value.createdAt, Date.now());

  if (!id || !direction || !name || !kind || !sourcePath || !targetPath || !status) {
    return null;
  }

  const retryPayload = normalizeTransferRetryPayload(value.retryPayload, direction);

  return {
    id,
    direction,
    name,
    kind,
    size: Math.max(0, finiteNumber(value.size, 0)),
    sourcePath,
    targetPath,
    status,
    progress: clamp(finiteNumber(value.progress, 0), 0, 100),
    createdAt,
    lastUpdatedAt: optionalFiniteNumber(value.lastUpdatedAt),
    attemptCount: optionalFiniteNumber(value.attemptCount),
    bytesTransferred: optionalFiniteNumber(value.bytesTransferred),
    speedBytesPerSecond: optionalFiniteNumber(value.speedBytesPerSecond),
    filesTransferred: optionalFiniteNumber(value.filesTransferred),
    skipped: optionalFiniteNumber(value.skipped),
    renamed: optionalFiniteNumber(value.renamed),
    currentPath: stringValue(value.currentPath) || undefined,
    currentFileBytes: optionalFiniteNumber(value.currentFileBytes),
    currentFileTotalBytes:
      value.currentFileTotalBytes === null ? null : optionalFiniteNumber(value.currentFileTotalBytes),
    errorMessage: stringValue(value.errorMessage) || undefined,
    retryPayload,
  };
}

function normalizeTransferRetryPayload(value: unknown, direction: TransferDirection): TransferRetryPayload | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const connection = normalizeConnectionDraft(value.connection);
  const localDirectory = stringValue(value.localDirectory);
  const remoteDirectory = stringValue(value.remoteDirectory);
  const targetConnection = normalizeConnectionDraft(value.targetConnection);
  const targetRemoteDirectory = stringValue(value.targetRemoteDirectory) || undefined;

  if (!connection || !localDirectory || !remoteDirectory) {
    return undefined;
  }

  if (direction === 'remoteCopy' && !targetConnection) {
    return undefined;
  }

  return {
    connection,
    targetConnection,
    localDirectory,
    remoteDirectory,
    targetRemoteDirectory,
  };
}

function normalizeConnectionDraft(value: unknown): ConnectionDraft | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const protocol = protocolOption(value.protocol);
  const host = stringValue(value.host);
  const path = stringValue(value.path);
  if (!protocol || !host || !path) {
    return undefined;
  }

  const port = stringValue(value.port) || undefined;
  const paths = Array.isArray(value.paths)
    ? value.paths.map(stringValue).filter(Boolean).slice(0, 24)
    : undefined;
  const username = stringValue(value.username) || undefined;
  const password = stringValue(value.password) || undefined;
  const terminalProfile = terminalProfileOption(value.terminalProfile);

  return {
    name: stringValue(value.name) || undefined,
    protocol,
    host,
    port,
    path,
    paths,
    username,
    password,
    terminalProfile,
    legacySshHostKeyAlgorithms:
      typeof value.legacySshHostKeyAlgorithms === 'boolean'
        ? value.legacySshHostKeyAlgorithms
        : undefined,
  };
}

function transferDirection(value: unknown): TransferDirection | null {
  return value === 'upload' || value === 'download' || value === 'remoteCopy' ? value : null;
}

function protocolOption(value: unknown): ProtocolOption | null {
  return value === 'SFTP' || value === 'SCP' || value === 'FTP' || value === 'FTPS' || value === 'WebDAV'
    ? value
    : null;
}

function terminalProfileOption(value: unknown): TerminalProfile | undefined {
  return value === 'auto' ||
    value === 'posix' ||
    value === 'bash' ||
    value === 'zsh' ||
    value === 'fish' ||
    value === 'powershell' ||
    value === 'cmd'
    ? value
    : undefined;
}

function transferStatus(value: unknown): TransferStatus | null {
  return value === 'queued' ||
    value === 'running' ||
    value === 'done' ||
    value === 'failed' ||
    value === 'cancelled'
    ? value
    : null;
}

function browseEntryKind(value: unknown): BrowseEntry['kind'] | null {
  return value === 'file' || value === 'directory' ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
