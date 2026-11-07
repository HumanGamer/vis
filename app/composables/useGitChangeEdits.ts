import { computed, shallowRef, watch, type Ref } from 'vue';
import type { FileDiffInfo } from '@opencode/client';
import type { RecentFileEdit } from './useRecentArtifacts';
import type { GitSnapshot } from '../utils/git/actions';
import { gitPath } from '../utils/git/git-path';

/** At most this many changed files are shown in the activity panel. */
const MAX_FILES = 200;

type Source = { snapshot: GitSnapshot; patch?: string } | null;

/** A cheap content hash, so an unchanged diff keeps its key. */
function hash(text: string) {
  let value = 5381;
  for (let i = 0; i < text.length; i++) value = (Math.imul(value, 33) ^ text.charCodeAt(i)) >>> 0;
  return value.toString(36) + text.length.toString(36);
}

/** The file a `diff --git a/X b/X` header names (the new side). */
function headerPath(header: string) {
  const rest = header.slice('diff --git '.length);
  const quoted = /^(?:"(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*")$/.exec(rest);
  if (quoted) return gitPath(quoted[1]).file.replace(/^b\//, '');
  // Unquoted: "a/X b/X" with the same X on both sides.
  const length = (rest.length - 5) / 2;
  if (Number.isInteger(length) && length > 0) return rest.slice(length + 5);
  return rest.split(' b/').at(-1) ?? rest;
}

/** Split a multi-file patch into one entry per file. */
function splitPatch(text: string) {
  const files: Array<{ file: string; patch: string }> = [];
  let current: { file: string; lines: string[] } | undefined;
  const flush = () => {
    if (current) files.push({ file: current.file, patch: current.lines.join('\n') + '\n' });
  };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('diff --git ')) {
      flush();
      current = { file: headerPath(line), lines: [line] };
    } else if (current) current.lines.push(line);
  }
  flush();
  return files;
}

function countLines(patch: string) {
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) inHunk = true;
    else if (!inHunk) continue;
    else if (line.startsWith('+')) additions++;
    else if (line.startsWith('-')) deletions++;
  }
  return { additions, deletions };
}

/**
 * Every file with uncommitted changes (staged, unstaged or untracked) as a
 * diff against HEAD, in the same shape as the recent edits list. The diffs
 * arrive with the file tree's own Git refresh (see `includePatch`), so this
 * runs no Git commands of its own.
 */
export function useGitChangeEdits(
  source: Ref<Source>,
  /** Ask the file tree's Git refresh to include the patch. */
  includePatch: Ref<boolean>,
  enabled: Ref<boolean>,
) {
  const edits = shallowRef<RecentFileEdit[]>([]);
  /** Whether diffs have been shown since enabling; later changes are marked as new. */
  let settled = false;

  watch(
    enabled,
    (value) => {
      includePatch.value = value;
      if (!value) settled = false;
    },
    { immediate: true },
  );

  watch(
    source,
    (value) => {
      if (!value) {
        edits.value = [];
        settled = false;
        return;
      }
      if (value.patch === undefined) return;
      const previous = new Map(edits.value.map((entry) => [entry.file.file, entry]));
      const untracked = new Set(value.snapshot.untracked.map((file) => file.file));
      const now = Date.now();
      edits.value = splitPatch(value.patch)
        .sort((a, b) => a.file.localeCompare(b.file))
        .slice(0, MAX_FILES)
        .map(({ file, patch }) => {
          const key = `git:${file}:${hash(patch)}`;
          const old = previous.get(file);
          if (old?.key === key) return old;
          const diff: FileDiffInfo = {
            file,
            patch,
            ...countLines(patch),
            status:
              untracked.has(file) || /^new file mode/m.test(patch)
                ? 'added'
                : /^deleted file mode/m.test(patch)
                  ? 'deleted'
                  : 'modified',
          };
          // Order 0 for the first load: the panel jumps only to later changes.
          return { key, file: diff, order: settled ? now : 0 };
        });
      settled = true;
    },
    { immediate: true },
  );

  /** Waiting for the first refresh that carries the patch. */
  const loading = computed(() => enabled.value && source.value?.patch === undefined);

  return { edits, loading };
}
