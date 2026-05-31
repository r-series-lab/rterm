import type { FavoriteItem, SessionItem, TimelineItem } from './rterm-types';

export const sessions: SessionItem[] = [
  {
    id: 'session-ops',
    host: 'files.internal',
    port: 22,
    path: '/srv/releases/current',
    status: 'online',
    protocol: 'SFTP',
    lastSeen: '刚刚',
  },
  {
    id: 'session-assets',
    host: 'assets.office',
    port: 443,
    path: '/Volumes/assets',
    status: 'paused',
    protocol: 'WebDAV',
    lastSeen: '12 分钟前',
  },
  {
    id: 'session-ftp',
    host: 'legacy-gateway',
    port: 990,
    path: '/incoming',
    status: 'error',
    protocol: 'FTPS',
    lastSeen: '1 小时前',
  },
];

export const favorites: FavoriteItem[] = [
  {
    id: 'favorite-debug',
    name: '调试远端',
    host: 'debug-r.remote',
    port: 22,
    path: '/staging/design-review',
    protocol: 'SFTP',
  },
  {
    id: 'favorite-release',
    name: '生产发布目录',
    host: 'files.internal',
    port: 22,
    path: '/srv/releases/current',
    protocol: 'SFTP',
  },
  {
    id: 'favorite-archive',
    name: '归档仓库',
    host: 'assets.office',
    port: 443,
    path: '/Volumes/assets/archive',
    protocol: 'WebDAV',
  },
  {
    id: 'favorite-dropbox',
    name: '接收区',
    host: 'legacy-gateway',
    port: 990,
    path: '/incoming',
    protocol: 'FTPS',
  },
];

export const workbenchColumns = {
  local: [
    '设计文档',
    'src',
    'src-tauri',
    'web',
    'scripts',
    'fixtures',
    'Cargo.toml',
    'package.json',
    'README.md',
    'CHANGELOG.md',
    '.env.example',
    'dist',
  ],
  remote: [
    'current',
    'shared',
    'releases',
    'logs',
    'config',
    'backups',
    'tmp',
    'incoming',
    'assets',
    'scripts',
    'archive',
    'health.txt',
  ],
};

export const timeline: TimelineItem[] = [
  {
    id: 'event-1',
    title: '已连接到 files.internal',
    detail: '连接握手完成，工作目录状态已同步。',
    tone: 'success',
    time: '09:14',
  },
  {
    id: 'event-2',
    title: 'inventory.csv 存在更新冲突',
    detail: '远端存在更新版本，等待你决定覆盖还是保留。',
    tone: 'warning',
    time: '09:10',
  },
  {
    id: 'event-3',
    title: '重试队列已排入',
    detail: '链路恢复后会重新尝试剩余上传任务。',
    tone: 'info',
    time: '09:02',
  },
  {
    id: 'event-4',
    title: 'legacy-gateway 连接超时',
    detail: '短暂网络抖动后已恢复，但建议再次测试连通性。',
    tone: 'error',
    time: '08:48',
  },
];
