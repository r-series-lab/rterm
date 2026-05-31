import type { ElementType } from 'react';
import TerminalIcon from '@mui/icons-material/Terminal';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SettingsIcon from '@mui/icons-material/Settings';

export type AppPageId = 'sessions' | 'workbench' | 'settings';

export type AppModule = {
  id: AppPageId;
  label: string;
  description: string;
  icon: ElementType;
};

export const appModules: AppModule[] = [
  {
    id: 'sessions',
    label: '连接',
    description: '最近与收藏',
    icon: TerminalIcon,
  },
  {
    id: 'workbench',
    label: '工作台',
    description: '文件浏览',
    icon: FolderOpenIcon,
  },
  {
    id: 'settings',
    label: '设置',
    description: '偏好与默认',
    icon: SettingsIcon,
  },
];

export const appChrome = {
  productName: 'rTerm',
  tagline: '远程目录工作台',
  connectionState: '开发模式',
};
