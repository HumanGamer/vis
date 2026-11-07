export function formatGlobToolTitle(
  input: Record<string, unknown> | undefined,
): string | undefined {
  const pattern = typeof input?.pattern === 'string' ? input.pattern.trim() : '';
  const path = typeof input?.path === 'string' ? input.path.trim() : '';
  const include = typeof input?.include === 'string' ? input.include.trim() : '';
  const segments: string[] = [];
  if (pattern) segments.push(pattern);
  if (path) segments.push(`@ ${path}`);
  if (include) segments.push(`include ${include}`);
  const title = segments.join(' ');
  return title || undefined;
}

export function formatReadLikeToolTitle(
  input: Record<string, unknown> | undefined,
): string | undefined {
  const filePath = typeof input?.filePath === 'string' ? input.filePath.trim() : '';
  if (filePath) return filePath;
  const path = typeof input?.path === 'string' ? input.path.trim() : '';
  return path || undefined;
}

export function resolveReadWritePath(
  input: Record<string, unknown> | undefined,
  metadata: Record<string, unknown> | undefined,
  state: Record<string, unknown> | undefined,
): string | undefined {
  const filePath = typeof input?.filePath === 'string' ? input.filePath.trim() : '';
  if (filePath) return filePath;
  const path = typeof input?.path === 'string' ? input.path.trim() : '';
  if (path) return path;
  const metadataPath = typeof metadata?.filepath === 'string' ? metadata.filepath.trim() : '';
  if (metadataPath) return metadataPath;
  const title = typeof state?.title === 'string' ? state.title.trim() : '';
  return title || undefined;
}

export function resolveReadRange(input: Record<string, unknown> | undefined): {
  offset?: number;
  limit?: number;
} {
  const offsetValue = input?.offset;
  const limitValue = input?.limit;
  const offset =
    typeof offsetValue === 'number' && Number.isFinite(offsetValue) && offsetValue >= 0
      ? Math.floor(offsetValue)
      : undefined;
  const limit =
    typeof limitValue === 'number' && Number.isFinite(limitValue) && limitValue > 0
      ? Math.floor(limitValue)
      : undefined;
  return { offset, limit };
}

export function formatListToolTitle(
  input: Record<string, unknown> | undefined,
): string | undefined {
  const path = typeof input?.path === 'string' ? input.path.trim() : '';
  return path || undefined;
}

export function formatWebfetchToolTitle(
  input: Record<string, unknown> | undefined,
): string | undefined {
  const url = typeof input?.url === 'string' ? input.url.trim() : '';
  return url || undefined;
}

export function formatQueryToolTitle(
  input: Record<string, unknown> | undefined,
): string | undefined {
  const query = typeof input?.query === 'string' ? input.query.trim() : '';
  return query || undefined;
}

export function toolColor(tool: string): string {
  switch (tool) {
    case 'bash':
      return '#a855f7';
    case 'read':
      return '#60a5fa';
    case 'grep':
      return '#facc15';
    case 'glob':
      return '#facc15';
    case 'list':
      return '#60a5fa';
    case 'edit':
    case 'multiedit':
    case 'patch':
    case 'apply_patch':
      return '#f97316';
    case 'write':
      return '#f97316';
    case 'webfetch':
    case 'websearch':
    case 'codesearch':
      return '#2dd4bf';
    case 'task':
      return '#818cf8';
    case 'batch':
      return '#818cf8';
    case 'plan_enter':
    case 'plan_exit':
      return '#94a3b8';
    default:
      return '#64748b';
  }
}

/** Languages known by file name rather than extension. */
const LANGUAGE_BY_FILENAME: Record<string, string> = {
  'cmakelists.txt': 'cmake',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  dockerfile: 'docker',
};

export function guessLanguageFromPath(path?: string): string {
  if (!path) return 'text';
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  const byName = LANGUAGE_BY_FILENAME[name];
  if (byName) return byName;
  const ext = name.includes('.') ? name.split('.').pop() : undefined;
  switch (ext) {
    case 'cmake':
      return 'cmake';
    case 'mk':
      return 'makefile';
    case 'ini':
    case 'cfg':
      return 'ini';
    case 'bat':
    case 'cmd':
      return 'bat';
    case 'ps1':
      return 'powershell';
    case 'cs':
      return 'csharp';
    case 'kt':
      return 'kotlin';
    case 'swift':
      return 'swift';
    case 'lua':
      return 'lua';
    case 'm':
    case 'mm':
      return 'objective-c';
    case 'glsl':
    case 'vert':
    case 'frag':
      return 'glsl';
    case 'hlsl':
      return 'hlsl';
    case 'bash':
    case 'zsh':
      return 'shellscript';
    case 'hh':
    case 'hxx':
    case 'inl':
      return 'cpp';
    case 'ts':
      return 'typescript';
    case 'tsx':
      return 'tsx';
    case 'js':
      return 'javascript';
    case 'jsx':
      return 'jsx';
    case 'vue':
      return 'vue';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'diff':
    case 'patch':
      return 'diff';
    case 'sh':
      return 'shellscript';
    case 'py':
      return 'python';
    case 'java':
      return 'java';
    case 'php':
      return 'php';
    case 'sql':
      return 'sql';
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    case 'rb':
      return 'ruby';
    case 'toml':
      return 'toml';
    case 'xml':
      return 'xml';
    case 'c':
      return 'c';
    case 'cpp':
    case 'cc':
    case 'cxx':
      return 'cpp';
    case 'h':
    case 'hpp':
      return 'cpp';
    default:
      return 'text';
  }
}
