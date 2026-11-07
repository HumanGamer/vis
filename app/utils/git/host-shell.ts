import type { ConfigShellOption } from '@opencode/client';

/**
 * How Git scripts reach a POSIX shell on the OpenCode host.
 *
 * Git scripts are POSIX shell. OpenCode's shell API runs commands with the
 * host's configured shell: on macOS/Linux (or Git Bash on Windows) that shell
 * can start `/bin/sh` directly. PowerShell and cmd.exe cannot, so on those
 * hosts the script is handed to Git for Windows' bash, which ships the
 * `base64`, `awk` and `iconv` tools the scripts rely on.
 */
export type GitHostShell =
  | { kind: 'posix' }
  | { kind: 'powershell' | 'cmd'; bash: string; windows: true };

export type HostShellKind = 'posix' | 'powershell' | 'cmd';

const WINDOWS_COMMAND_LIMIT = 30000;
const POSIX_COMMAND_LIMIT = 60000;

export function classifyShell(path: string): HostShellKind {
  const name = path.split(/[\\/]/).at(-1)?.toLowerCase() ?? '';
  if (/^(pwsh|powershell)(\.exe)?$/.test(name)) return 'powershell';
  if (/^cmd(\.exe)?$/.test(name)) return 'cmd';
  return 'posix';
}

function isWslLauncher(path: string) {
  return /\\(system32|sysnative)\\(bash|wsl)\.exe$/i.test(path);
}

/** Pick Git for Windows' bash from OpenCode's list of shells on the host. */
export function findGitBash(options: readonly ConfigShellOption[]): string | undefined {
  const candidates = options
    .filter((option) => option.acceptable && /\\(ba)?sh\.exe$/i.test(option.path))
    .filter((option) => !isWslLauncher(option.path))
    .map((option) => option.path);
  // Git\bin\bash.exe sets up PATH for the MSYS tools; prefer it over usr\bin.
  return (
    candidates.find((path) => /\\git\\bin\\bash\.exe$/i.test(path)) ??
    candidates.find((path) => /\\git\\/i.test(path)) ??
    candidates[0]
  );
}

/** Derive Git Bash from the location of git.exe (`...\Git\cmd\git.exe` and similar). */
export function gitBashFromGitPath(gitPath: string): string | undefined {
  const line = gitPath
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => /\\git\.exe$/i.test(entry));
  if (!line) return;
  const root = line.replace(
    /\\(cmd|bin|mingw64\\bin|mingw32\\bin|clangarm64\\bin)\\git\.exe$/i,
    '',
  );
  if (root === line) return;
  return `${root}\\bin\\bash.exe`;
}

/** A command that prints git.exe's path in the given Windows shell. */
export function locateGitCommand(kind: 'powershell' | 'cmd') {
  return kind === 'powershell' ? '(Get-Command git -ErrorAction Stop).Source' : 'where git';
}

function base64Utf8(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Build the command string for OpenCode's shell API.
 *
 * On Windows the script travels as base64 so that neither PowerShell nor cmd
 * quoting can alter it; the bash side decodes it into one word (IFS empty,
 * globbing off) and evaluates it after restoring normal splitting.
 */
export function wrapGitScript(shell: GitHostShell, script: string) {
  if (shell.kind === 'posix') {
    const command = `/bin/sh -c '${script.replaceAll("'", "'\\''")}'`;
    checkLength(command, POSIX_COMMAND_LIMIT);
    return command;
  }
  const prelude = 'unset IFS; set +f; export PATH="/usr/bin:/mingw64/bin:$PATH"\n';
  const inner = `set -f;IFS=;eval $(echo ${base64Utf8(prelude + script)}|base64 -d)`;
  const command =
    shell.kind === 'powershell'
      ? `& '${shell.bash.replaceAll("'", "''")}' -c '${inner}'`
      : `set "PATH=${shell.bash.replace(/\\[^\\]+$/, '')};%PATH%" && bash -c "${inner}"`;
  checkLength(command, WINDOWS_COMMAND_LIMIT);
  return command;
}

function checkLength(command: string, limit: number) {
  // The shell API passes the entire command as one argument (and Windows caps
  // command lines at 32767 characters).
  if (new TextEncoder().encode(command).length > limit)
    throw new Error('Git command exceeds the shell argument limit. Select fewer files.');
}
