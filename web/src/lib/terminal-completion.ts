import type { BrowseEntry, FavoriteItem, TerminalHistoryEntry, TerminalProfile } from './rterm-types';

export type TerminalCompletionSourceName =
  | 'history'
  | 'filesystem'
  | 'connections'
  | 'git'
  | 'snippets'
  | 'customCommands';

export type TerminalCompletionConfig = {
  enabled: boolean;
  acceptKey: 'tab' | 'arrowRight' | 'ctrlSpace';
  maxSuggestions: number;
  minInputLength: number;
  sources: Record<TerminalCompletionSourceName, boolean>;
  customCommands: TerminalCompletionCommand[];
  snippets: TerminalCompletionSnippet[];
  profiles: Partial<Record<TerminalProfile, TerminalCompletionProfileConfig>>;
  privacy: {
    ignorePatterns: string[];
  };
};

export type TerminalCompletionProfileConfig = {
  extends?: TerminalProfile;
  customCommands?: TerminalCompletionCommand[];
  snippets?: TerminalCompletionSnippet[];
};

export type TerminalCompletionCommand = {
  name: string;
  description?: string;
  insert: string;
};

export type TerminalCompletionSnippet = {
  trigger: string;
  description?: string;
  insert: string;
};

export type TerminalCompletionConfigFile = {
  path: string | null;
  config: TerminalCompletionConfig;
};

export type TerminalCompletionSuggestion = {
  id: string;
  source: TerminalCompletionSourceName;
  label: string;
  detail?: string;
  insert: string;
  replaceStart: number;
  replaceEnd: number;
};

export type TerminalCompletionContext = {
  input: string;
  config: TerminalCompletionConfig;
  history: TerminalHistoryEntry[];
  sessionCommands: string[];
  directory: string;
  targetProfile: TerminalProfile;
  entries: BrowseEntry[];
  favorites: FavoriteItem[];
};

const DEFAULT_SOURCES: Record<TerminalCompletionSourceName, boolean> = {
  history: true,
  filesystem: true,
  connections: true,
  git: true,
  snippets: true,
  customCommands: true,
};

const DEFAULT_CUSTOM_COMMANDS: TerminalCompletionCommand[] = [];

const POSIX_COMMANDS: TerminalCompletionCommand[] = [
  {
    name: 'ls -la',
    description: '列出当前目录的详细文件信息',
    insert: 'ls -la',
  },
  {
    name: 'dir',
    description: '列出目录内容',
    insert: 'dir',
  },
  {
    name: 'pwd',
    description: '显示当前目录',
    insert: 'pwd',
  },
  {
    name: 'cp',
    description: '复制文件或目录',
    insert: 'cp ',
  },
  {
    name: 'scp',
    description: '通过 SSH 复制文件',
    insert: 'scp ',
  },
  {
    name: 'rsync -av',
    description: '同步文件或目录',
    insert: 'rsync -av ',
  },
  {
    name: 'mv',
    description: '移动或重命名文件',
    insert: 'mv ',
  },
  {
    name: 'rm -i',
    description: '交互式删除文件',
    insert: 'rm -i ',
  },
  {
    name: 'mkdir -p',
    description: '创建目录',
    insert: 'mkdir -p ',
  },
  {
    name: 'cat',
    description: '输出文件内容',
    insert: 'cat ',
  },
  {
    name: 'grep -R',
    description: '递归搜索文本',
    insert: 'grep -R ',
  },
  {
    name: 'du -sh *',
    description: '查看当前目录下各项目体积',
    insert: 'du -sh *',
  },
  {
    name: 'df -h',
    description: '查看磁盘空间',
    insert: 'df -h',
  },
  {
    name: 'find . -maxdepth 2 -type f',
    description: '快速列出两层以内的文件',
    insert: 'find . -maxdepth 2 -type f',
  },
  {
    name: 'tar -xzf',
    description: '解压 .tar.gz 文件',
    insert: 'tar -xzf ',
  },
  {
    name: 'chmod',
    description: '修改文件权限',
    insert: 'chmod ',
  },
  {
    name: 'ssh',
    description: '启动 SSH 连接',
    insert: 'ssh ',
  },
  {
    name: 'tail -f',
    description: '持续查看日志文件',
    insert: 'tail -f ',
  },
];

const BASH_COMMANDS: TerminalCompletionCommand[] = [
  {
    name: 'history | tail -20',
    description: '查看最近 shell 历史',
    insert: 'history | tail -20',
  },
  {
    name: 'alias',
    description: '列出 Bash alias',
    insert: 'alias',
  },
];

const ZSH_COMMANDS: TerminalCompletionCommand[] = [
  {
    name: 'history -20',
    description: '查看最近 zsh 历史',
    insert: 'history -20',
  },
  {
    name: 'whence',
    description: '查看命令来源',
    insert: 'whence ',
  },
];

const FISH_COMMANDS: TerminalCompletionCommand[] = [
  {
    name: 'history | head -20',
    description: '查看最近 fish 历史',
    insert: 'history | head -20',
  },
  {
    name: 'functions',
    description: '列出 fish 函数',
    insert: 'functions',
  },
];

const POWERSHELL_COMMANDS: TerminalCompletionCommand[] = [
  {
    name: 'dir',
    description: '列出当前目录',
    insert: 'dir',
  },
  {
    name: 'Get-ChildItem',
    description: '列出目录内容',
    insert: 'Get-ChildItem',
  },
  {
    name: 'pwd',
    description: '显示当前目录',
    insert: 'pwd',
  },
  {
    name: 'Get-Location',
    description: '显示当前目录',
    insert: 'Get-Location',
  },
  {
    name: 'cd',
    description: '切换目录',
    insert: 'cd ',
  },
  {
    name: 'ls',
    description: '列出目录内容（PowerShell alias）',
    insert: 'ls',
  },
  {
    name: 'cp',
    description: '复制项目（PowerShell alias）',
    insert: 'cp ',
  },
  {
    name: 'Copy-Item',
    description: '复制文件或目录',
    insert: 'Copy-Item ',
  },
  {
    name: 'scp',
    description: '通过 OpenSSH 复制文件',
    insert: 'scp ',
  },
  {
    name: 'Move-Item',
    description: '移动或重命名项目',
    insert: 'Move-Item ',
  },
  {
    name: 'mv',
    description: '移动或重命名项目（PowerShell alias）',
    insert: 'mv ',
  },
  {
    name: 'Remove-Item',
    description: '删除项目',
    insert: 'Remove-Item ',
  },
  {
    name: 'rm',
    description: '删除项目（PowerShell alias）',
    insert: 'rm ',
  },
  {
    name: 'New-Item -ItemType Directory',
    description: '创建目录',
    insert: 'New-Item -ItemType Directory ',
  },
  {
    name: 'mkdir',
    description: '创建目录（PowerShell alias）',
    insert: 'mkdir ',
  },
  {
    name: 'Get-Content -Tail 100',
    description: '查看文件尾部',
    insert: 'Get-Content -Tail 100 ',
  },
  {
    name: 'cat',
    description: '输出文件内容（PowerShell alias）',
    insert: 'cat ',
  },
  {
    name: 'type',
    description: '输出文件内容（PowerShell alias）',
    insert: 'type ',
  },
  {
    name: 'Select-String',
    description: '搜索文本',
    insert: 'Select-String ',
  },
  {
    name: 'Get-Process',
    description: '查看进程',
    insert: 'Get-Process',
  },
  {
    name: 'Test-Path',
    description: '检查路径是否存在',
    insert: 'Test-Path ',
  },
  {
    name: 'ssh',
    description: '启动 SSH 连接',
    insert: 'ssh ',
  },
];

const CMD_COMMANDS: TerminalCompletionCommand[] = [
  {
    name: 'dir',
    description: '列出目录内容',
    insert: 'dir',
  },
  {
    name: 'cd',
    description: '切换目录',
    insert: 'cd ',
  },
  {
    name: 'copy',
    description: '复制文件',
    insert: 'copy ',
  },
  {
    name: 'xcopy',
    description: '复制目录树',
    insert: 'xcopy ',
  },
  {
    name: 'robocopy',
    description: '稳健复制目录',
    insert: 'robocopy ',
  },
  {
    name: 'del',
    description: '删除文件',
    insert: 'del ',
  },
  {
    name: 'type',
    description: '输出文件内容',
    insert: 'type ',
  },
  {
    name: 'findstr',
    description: '搜索文本',
    insert: 'findstr ',
  },
  {
    name: 'mkdir',
    description: '创建目录',
    insert: 'mkdir ',
  },
  {
    name: 'move',
    description: '移动或重命名项目',
    insert: 'move ',
  },
  {
    name: 'where',
    description: '查找命令路径',
    insert: 'where ',
  },
  {
    name: 'ipconfig',
    description: '查看网络配置',
    insert: 'ipconfig',
  },
  {
    name: 'tasklist',
    description: '查看进程',
    insert: 'tasklist',
  },
  {
    name: 'scp',
    description: '通过 OpenSSH 复制文件',
    insert: 'scp ',
  },
  {
    name: 'ssh',
    description: '启动 SSH 连接',
    insert: 'ssh ',
  },
];

const DEFAULT_SNIPPETS: TerminalCompletionSnippet[] = [
  {
    trigger: 'untar',
    description: '解压 .tar.gz 文件',
    insert: 'tar -xzf ',
  },
  {
    trigger: 'mkcd',
    description: '创建目录并进入',
    insert: 'mkdir -p  && cd ',
  },
  {
    trigger: 'ports',
    description: '查看监听端口',
    insert: 'lsof -i -P -n | grep LISTEN',
  },
];

const POWERSHELL_SNIPPETS: TerminalCompletionSnippet[] = [
  {
    trigger: 'tail',
    description: '查看文件尾部',
    insert: 'Get-Content -Tail 100 ',
  },
  {
    trigger: 'grep',
    description: '搜索文本',
    insert: 'Select-String ',
  },
];

const CMD_SNIPPETS: TerminalCompletionSnippet[] = [
  {
    trigger: 'grep',
    description: '搜索文本',
    insert: 'findstr ',
  },
];

const DEFAULT_PROFILES: Partial<Record<TerminalProfile, TerminalCompletionProfileConfig>> = {
  auto: {
    extends: 'posix',
  },
  posix: {
    customCommands: POSIX_COMMANDS,
    snippets: DEFAULT_SNIPPETS,
  },
  bash: {
    extends: 'posix',
    customCommands: BASH_COMMANDS,
  },
  zsh: {
    extends: 'posix',
    customCommands: ZSH_COMMANDS,
  },
  fish: {
    extends: 'posix',
    customCommands: FISH_COMMANDS,
  },
  powershell: {
    customCommands: POWERSHELL_COMMANDS,
    snippets: POWERSHELL_SNIPPETS,
  },
  cmd: {
    customCommands: CMD_COMMANDS,
    snippets: CMD_SNIPPETS,
  },
};

const GIT_COMMANDS: TerminalCompletionCommand[] = [
  {
    name: 'git status',
    description: '查看工作区状态',
    insert: 'git status',
  },
  {
    name: 'git pull --ff-only',
    description: '只允许快进拉取',
    insert: 'git pull --ff-only',
  },
  {
    name: 'git log --oneline -10',
    description: '查看最近 10 条提交',
    insert: 'git log --oneline -10',
  },
  {
    name: 'git diff --stat',
    description: '查看变更概览',
    insert: 'git diff --stat',
  },
];

export const defaultTerminalCompletionConfig: TerminalCompletionConfig = {
  enabled: true,
  acceptKey: 'tab',
  maxSuggestions: 5,
  minInputLength: 1,
  sources: DEFAULT_SOURCES,
  customCommands: DEFAULT_CUSTOM_COMMANDS,
  snippets: [],
  profiles: DEFAULT_PROFILES,
  privacy: {
    ignorePatterns: ['*token*', '*password*', '*secret*', '*passwd*', '*private_key*'],
  },
};

export function normalizeTerminalCompletionConfig(value: unknown): TerminalCompletionConfig {
  if (!isRecord(value)) {
    return defaultTerminalCompletionConfig;
  }

  const rawSources = isRecord(value.sources) ? value.sources : {};
  const rawPrivacy = isRecord(value.privacy) ? value.privacy : {};
  const acceptKey =
    value.acceptKey === 'arrowRight' || value.acceptKey === 'ctrlSpace' || value.acceptKey === 'tab'
      ? value.acceptKey
      : defaultTerminalCompletionConfig.acceptKey;

  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : defaultTerminalCompletionConfig.enabled,
    acceptKey,
    maxSuggestions: clampInteger(value.maxSuggestions, 1, 8, defaultTerminalCompletionConfig.maxSuggestions),
    minInputLength: clampInteger(value.minInputLength, 0, 24, defaultTerminalCompletionConfig.minInputLength),
    sources: {
      history: rawSources.history === undefined ? true : rawSources.history === true,
      filesystem: rawSources.filesystem === undefined ? true : rawSources.filesystem === true,
      connections: rawSources.connections === undefined ? true : rawSources.connections === true,
      git: rawSources.git === undefined ? true : rawSources.git === true,
      snippets: rawSources.snippets === undefined ? true : rawSources.snippets === true,
      customCommands: rawSources.customCommands === undefined ? true : rawSources.customCommands === true,
    },
    customCommands: normalizeCommandList(value.customCommands),
    snippets: normalizeSnippetList(value.snippets),
    profiles: normalizeProfileConfig(value.profiles),
    privacy: {
      ignorePatterns: normalizeStringList(rawPrivacy.ignorePatterns, defaultTerminalCompletionConfig.privacy.ignorePatterns),
    },
  };
}

export function buildTerminalCompletionSuggestions({
  input,
  config,
  history,
  sessionCommands,
  targetProfile,
  entries,
  favorites,
}: TerminalCompletionContext): TerminalCompletionSuggestion[] {
  if (!config.enabled) {
    return [];
  }

  const boundedInput = input.slice(-240);
  const trimmedInput = boundedInput.trim();
  if (trimmedInput.length < config.minInputLength || hasIgnoredContent(boundedInput, config)) {
    return [];
  }

  const suggestions: TerminalCompletionSuggestion[] = [];
  const seen = new Set<string>();
  const addSuggestion = (suggestion: TerminalCompletionSuggestion) => {
    const normalized = suggestion.insert.trim().toLowerCase();
    if (!normalized || seen.has(`${suggestion.source}:${normalized}`) || hasIgnoredContent(suggestion.insert, config)) {
      return;
    }

    seen.add(`${suggestion.source}:${normalized}`);
    suggestions.push(suggestion);
  };

  if (config.sources.customCommands) {
    commandSuggestions(resolveProfileCommands(config, targetProfile), boundedInput, 'customCommands').forEach(addSuggestion);
  }

  if (config.sources.snippets) {
    snippetSuggestions(resolveProfileSnippets(config, targetProfile), boundedInput).forEach(addSuggestion);
  }

  if (config.sources.git) {
    commandSuggestions(GIT_COMMANDS, boundedInput, 'git').forEach(addSuggestion);
  }

  if (config.sources.history) {
    historySuggestions(history, sessionCommands, boundedInput).forEach(addSuggestion);
  }

  if (config.sources.filesystem) {
    filesystemSuggestions(entries, boundedInput).forEach(addSuggestion);
  }

  if (config.sources.connections) {
    connectionSuggestions(favorites, boundedInput).forEach(addSuggestion);
  }

  return suggestions.slice(0, config.maxSuggestions);
}

export function nextTerminalCompletionInput(current: string, data: string): string {
  if (data === '\r' || data === '\n') {
    return '';
  }

  if (data === '\x03' || data === '\x04' || data === '\x15') {
    return '';
  }

  if (data === '\x7f' || data === '\b') {
    return current.slice(0, -1);
  }

  if (data === '\x17') {
    return current.replace(/\s*\S+$/, '');
  }

  if (data === '\t' || data.startsWith('\x1b')) {
    return current;
  }

  const printable = data
    .split('')
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('');

  return `${current}${printable}`.slice(-240);
}

export function recordSubmittedTerminalCommand(current: string, data: string): string | null {
  if (data !== '\r' && data !== '\n') {
    return null;
  }

  const command = current.trim();
  return command.length > 0 ? command : null;
}

export function applyTerminalCompletionSuggestion(
  input: string,
  suggestion: TerminalCompletionSuggestion,
): string {
  return `${input.slice(0, suggestion.replaceStart)}${suggestion.insert}${input.slice(suggestion.replaceEnd)}`;
}

export function buildTerminalCompletionAcceptInput(
  input: string,
  suggestion: TerminalCompletionSuggestion,
): string {
  const backspaceCount = Math.max(0, input.length - suggestion.replaceStart);
  const backspaces = '\x7f'.repeat(backspaceCount);
  return `${backspaces}${suggestion.insert}${input.slice(suggestion.replaceEnd)}`;
}

export function terminalCompletionAcceptKeyLabel(config: TerminalCompletionConfig): string {
  if (config.acceptKey === 'arrowRight') {
    return '→';
  }

  if (config.acceptKey === 'ctrlSpace') {
    return 'Ctrl Space';
  }

  return 'Tab';
}

export function shouldAcceptTerminalCompletion(
  event: KeyboardEvent,
  config: TerminalCompletionConfig,
): boolean {
  if (config.acceptKey === 'tab') {
    return event.key === 'Tab' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
  }

  if (config.acceptKey === 'arrowRight') {
    return event.key === 'ArrowRight' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
  }

  return event.code === 'Space' && event.ctrlKey && !event.metaKey && !event.altKey;
}

function commandSuggestions(
  commands: TerminalCompletionCommand[],
  input: string,
  source: TerminalCompletionSourceName,
): TerminalCompletionSuggestion[] {
  const query = input.trimStart();
  const replaceStart = input.length - query.length;
  const normalizedQuery = query.toLowerCase();

  return commands
    .filter((command) => command.insert.trim())
    .filter((command) => command.insert.toLowerCase().startsWith(normalizedQuery))
    .filter((command) => command.insert !== query)
    .slice(0, 16)
    .map((command) => ({
      id: `${source}:${command.insert}`,
      source,
      label: command.name || command.insert,
      detail: command.description,
      insert: command.insert,
      replaceStart,
      replaceEnd: input.length,
    }));
}

function snippetSuggestions(snippets: TerminalCompletionSnippet[], input: string): TerminalCompletionSuggestion[] {
  const token = currentToken(input);
  const normalizedToken = token.value.toLowerCase();

  if (!normalizedToken) {
    return [];
  }

  return snippets
    .filter((snippet) => snippet.trigger.toLowerCase().startsWith(normalizedToken))
    .filter((snippet) => snippet.trigger.toLowerCase() !== normalizedToken || snippet.insert !== token.value)
    .slice(0, 10)
    .map((snippet) => ({
      id: `snippets:${snippet.trigger}`,
      source: 'snippets',
      label: snippet.trigger,
      detail: snippet.description,
      insert: snippet.insert,
      replaceStart: token.start,
      replaceEnd: input.length,
    }));
}

function historySuggestions(
  history: TerminalHistoryEntry[],
  sessionCommands: string[],
  input: string,
): TerminalCompletionSuggestion[] {
  const query = input.trimStart();
  const replaceStart = input.length - query.length;
  const normalizedQuery = query.toLowerCase();
  const commands = [...sessionCommands, ...history.map((entry) => entry.command)].filter(Boolean);
  const seen = new Set<string>();

  return commands
    .filter((command) => {
      const normalized = command.toLowerCase();
      if (seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return normalized.startsWith(normalizedQuery) && command !== query;
    })
    .slice(0, 8)
    .map((command) => ({
      id: `history:${command}`,
      source: 'history',
      label: command,
      detail: '当前会话历史',
      insert: command,
      replaceStart,
      replaceEnd: input.length,
    }));
}

function filesystemSuggestions(entries: BrowseEntry[], input: string): TerminalCompletionSuggestion[] {
  const token = currentToken(input);
  const rawToken = token.value.replace(/^['"]/, '');
  const slashIndex = rawToken.lastIndexOf('/');
  const basenamePrefix = slashIndex >= 0 ? rawToken.slice(slashIndex + 1) : rawToken;
  const normalizedPrefix = basenamePrefix.toLowerCase();

  if (!normalizedPrefix) {
    return [];
  }

  return entries
    .filter((entry) => entry.name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, 10)
    .map((entry) => {
      const prefix = slashIndex >= 0 ? rawToken.slice(0, slashIndex + 1) : '';
      const insert = `${prefix}${shellEscapeToken(entry.name)}${entry.kind === 'directory' ? '/' : ''}`;

      return {
        id: `filesystem:${entry.path}`,
        source: 'filesystem' as TerminalCompletionSourceName,
        label: entry.name,
        detail: entry.kind === 'directory' ? '当前目录' : '当前文件',
        insert,
        replaceStart: token.start,
        replaceEnd: input.length,
      };
    });
}

function connectionSuggestions(favorites: FavoriteItem[], input: string): TerminalCompletionSuggestion[] {
  const query = input.trimStart();
  const replaceStart = input.length - query.length;
  const pathCandidates = favorites.flatMap((favorite) => [favorite.path, ...(favorite.paths ?? [])]);
  const seen = new Set<string>();

  return pathCandidates
    .map((path) => path.trim())
    .filter((path) => {
      if (!path || seen.has(path)) {
        return false;
      }

      seen.add(path);
      return `cd ${path}`.toLowerCase().startsWith(query.toLowerCase());
    })
    .slice(0, 8)
    .map((path) => ({
      id: `connections:${path}`,
      source: 'connections',
      label: `cd ${path}`,
      detail: '收藏目录',
      insert: `cd ${shellEscapePath(path)}`,
      replaceStart,
      replaceEnd: input.length,
    }));
}

function currentToken(input: string): { value: string; start: number } {
  const match = input.match(/(?:^|\s)(\S*)$/);
  if (!match) {
    return { value: input, start: 0 };
  }

  const value = match[1] ?? '';
  return {
    value,
    start: input.length - value.length,
  };
}

function normalizeCommandList(value: unknown): TerminalCompletionCommand[] {
  if (!Array.isArray(value)) {
    return defaultTerminalCompletionConfig.customCommands;
  }

  const commands = value
    .filter(isRecord)
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name.trim() : '',
      description: typeof item.description === 'string' ? item.description.trim() : undefined,
      insert: typeof item.insert === 'string' ? item.insert : '',
    }))
    .filter((item) => item.name && item.insert.trim())
    .slice(0, 80);

  return commands.length > 0 ? commands : defaultTerminalCompletionConfig.customCommands;
}

function normalizeSnippetList(value: unknown): TerminalCompletionSnippet[] {
  if (!Array.isArray(value)) {
    return defaultTerminalCompletionConfig.snippets;
  }

  const snippets = value
    .filter(isRecord)
    .map((item) => ({
      trigger: typeof item.trigger === 'string' ? item.trigger.trim() : '',
      description: typeof item.description === 'string' ? item.description.trim() : undefined,
      insert: typeof item.insert === 'string' ? item.insert : '',
    }))
    .filter((item) => item.trigger && item.insert)
    .slice(0, 80);

  return snippets.length > 0 ? snippets : defaultTerminalCompletionConfig.snippets;
}

function normalizeProfileConfig(value: unknown): Partial<Record<TerminalProfile, TerminalCompletionProfileConfig>> {
  if (!isRecord(value)) {
    return defaultTerminalCompletionConfig.profiles;
  }

  const profiles: Partial<Record<TerminalProfile, TerminalCompletionProfileConfig>> = {
    ...defaultTerminalCompletionConfig.profiles,
  };

  terminalProfiles().forEach((profileName) => {
    const rawProfile = value[profileName];
    if (!isRecord(rawProfile)) {
      return;
    }

    const previousProfile = profiles[profileName];
    const extendsProfile =
      rawProfile.extends === undefined ? previousProfile?.extends : normalizeTerminalProfile(rawProfile.extends);
    profiles[profileName] = {
      extends: extendsProfile === profileName ? undefined : extendsProfile,
      customCommands: Array.isArray(rawProfile.customCommands)
        ? normalizeCommandList(rawProfile.customCommands)
        : previousProfile?.customCommands,
      snippets: Array.isArray(rawProfile.snippets)
        ? normalizeSnippetList(rawProfile.snippets)
        : previousProfile?.snippets,
    };
  });

  return profiles;
}

function resolveProfileCommands(config: TerminalCompletionConfig, targetProfile: TerminalProfile): TerminalCompletionCommand[] {
  return [...config.customCommands, ...resolveProfileItems(config, targetProfile, 'customCommands')];
}

function resolveProfileSnippets(config: TerminalCompletionConfig, targetProfile: TerminalProfile): TerminalCompletionSnippet[] {
  return [...config.snippets, ...resolveProfileItems(config, targetProfile, 'snippets')];
}

function resolveProfileItems<T extends 'customCommands' | 'snippets'>(
  config: TerminalCompletionConfig,
  targetProfile: TerminalProfile,
  field: T,
): NonNullable<TerminalCompletionProfileConfig[T]> {
  const resolved: Array<TerminalCompletionCommand | TerminalCompletionSnippet> = [];
  const visited = new Set<TerminalProfile>();
  const visit = (profileName: TerminalProfile) => {
    if (visited.has(profileName)) {
      return;
    }

    visited.add(profileName);
    const profile = config.profiles[profileName];
    if (!profile) {
      return;
    }

    if (profile.extends) {
      visit(profile.extends);
    }

    resolved.push(...(profile[field] ?? []));
  };

  visit(normalizeTerminalProfile(targetProfile));

  return resolved as NonNullable<TerminalCompletionProfileConfig[T]>;
}

function normalizeTerminalProfile(value: unknown): TerminalProfile {
  return typeof value === 'string' && terminalProfiles().includes(value as TerminalProfile)
    ? value as TerminalProfile
    : 'auto';
}

function terminalProfiles(): TerminalProfile[] {
  return ['auto', 'posix', 'bash', 'zsh', 'fish', 'powershell', 'cmd'];
}

function normalizeStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const strings = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 80);

  return strings.length > 0 ? strings : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(numberValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numberValue));
}

function hasIgnoredContent(value: string, config: TerminalCompletionConfig): boolean {
  const normalized = value.toLowerCase();
  return config.privacy.ignorePatterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  return new RegExp(`^${escaped}$|${escaped}`);
}

function shellEscapePath(value: string): string {
  return value
    .split('/')
    .map((part, index) => (index === 0 && part === '' ? '' : shellEscapeToken(part)))
    .join('/');
}

function shellEscapeToken(value: string): string {
  if (!value) {
    return value;
  }

  if (/^[A-Za-z0-9._~@%+=:,/-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
