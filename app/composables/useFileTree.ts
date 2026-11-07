import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { useSessionState } from './useSessionState';
import type { useFloatingWindows } from './useFloatingWindows';
import type { TreeNode } from '../types/files';
import type { GitFileStatus, GitBranchInfo, GitDiffStats } from '../types/git';
import WorkingDiff from '../components/git/WorkingDiff.vue';
import ContentViewer from '../components/viewers/ContentViewer.vue';
import { guessLanguageFromPath } from '../components/ToolWindow/utils';
import hexdump from '@kikuchan/hexdump';
import { errorMessage } from '../utils/errors';
import { fileContent, findTreeNode, treeFiles } from '../utils/files';
import { createFileIndex } from '../utils/fileIndex';
import {
  locationPrefix,
  type GitActions,
  type GitPatch,
  type GitSnapshot,
} from '../utils/git/actions';

export function useFileTree(
  state: ReturnType<typeof useSessionState>,
  fw: ReturnType<typeof useFloatingWindows>,
  git: GitActions,
) {
  const nodes = ref<TreeNode[]>([]);
  const expanded = ref<string[]>([]);
  const selectedPath = ref<string>();
  const loading = ref(false);
  const error = ref('');
  const gitError = ref('');
  const gitStatus = ref<Record<string, GitFileStatus>>({});
  const branch = ref<GitBranchInfo | null>(null);
  const diffStats = ref<GitDiffStats | null>(null);
  /**
   * The latest Git snapshot, plus every uncommitted change as one patch when
   * `includePatch` is on (fetched in the same host command as the status).
   */
  const gitSnapshot = shallowRef<{ snapshot: GitSnapshot; patch?: string } | null>(null);
  const includePatch = ref(false);
  /** A filesystem change arrived that a full tree reload has not picked up yet. */
  let treeStale = false;
  const version = ref(0);
  const files = ref<string[]>([]);
  const scanning = ref(false);
  const indexNote = ref('');
  const scope = computed(() => state.selected.value?.location);
  const pending = new Set<string>();
  const reads = new Map<string, AbortController>();
  let controller = new AbortController();
  let generation = 0;
  let gitRevision = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  let index: ReturnType<typeof createFileIndex> | undefined;

  function publishFiles() {
    clearTimeout(publishTimer);
    publishTimer = undefined;
    files.value = treeFiles(nodes.value);
    version.value++;
  }

  function fileIndex() {
    if (index) return index;
    const location = scope.value;
    if (!location) throw new Error('Select a session before loading files.');
    const current = generation;
    const signal = controller.signal;
    index = createFileIndex({
      directory: location.directory,
      projectDirectory: async () => (await state.readLocation(location, signal)).project.directory,
      signal,
      list: (path) => state.listFiles(location, path, signal),
      read: (path) => state.readFile(location, path, signal),
      report: (cause) => {
        if (current === generation) error.value = errorMessage(cause);
      },
      publish: (path, children) => {
        if (current !== generation) return;
        if (path === '.') nodes.value = children;
        else {
          const node = findTreeNode(nodes.value, path);
          if (!node) return;
          node.children = children;
          node.loaded = true;
        }
        if (!publishTimer) publishTimer = setTimeout(publishFiles, 200);
      },
    });
    return index;
  }

  async function preload() {
    if (!scope.value) return;
    const current = generation;
    scanning.value = true;
    try {
      const limited = await fileIndex().scan();
      if (current === generation && limited)
        indexNote.value = 'Automatic file indexing limit reached. Expand directories to load more.';
    } catch (cause) {
      if (current === generation) error.value = errorMessage(cause);
    } finally {
      if (current === generation) {
        scanning.value = false;
        publishFiles();
      }
    }
  }

  async function loadGit() {
    const location = scope.value;
    if (!location) return;
    const current = generation;
    const request = ++gitRevision;
    try {
      const [result, { snapshot, statistics: counts, patch }] = await Promise.all([
        state.readVcs(location, controller.signal),
        git.overview(undefined, { patch: includePatch.value }),
      ]);
      if (current !== generation || request !== gitRevision) return;
      gitError.value = '';
      gitSnapshot.value = { snapshot, patch };
      branch.value = result.info.branch.current
        ? { branch: result.info.branch.current, ahead: 0, behind: 0 }
        : null;
      const prefix = locationPrefix(location.directory, snapshot.root);
      gitStatus.value = Object.fromEntries(
        Object.values(snapshot.status)
          .filter((file) => file.path.startsWith(prefix))
          .map((file) => {
            const path = file.path.slice(prefix.length);
            return [path, { ...file, path }];
          }),
      );
      const stats = (files: GitPatch[]) => ({
        additions: files.reduce((sum, file) => sum + file.additions, 0),
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      });
      const isUntracked = (file: { file: string }) => snapshot.status[file.file]?.index === '?';
      const tracked = result.status.filter((file) => !isUntracked(file));
      diffStats.value = {
        staged: stats(counts.staged),
        unstaged: stats(counts.unstaged),
        changes: {
          additions: tracked.reduce((sum, file) => sum + file.additions, 0),
          deletions: tracked.reduce((sum, file) => sum + file.deletions, 0),
          untracked: result.status
            .filter(isUntracked)
            .reduce((sum, file) => sum + file.additions, 0),
        },
      };
    } catch (cause) {
      if (current === generation && request === gitRevision) {
        gitError.value = errorMessage(cause);
        gitStatus.value = {};
        diffStats.value = null;
        gitSnapshot.value = null;
      }
    }
  }

  async function openDiff(path?: string, staged = false) {
    const location = scope.value;
    if (!location) return;
    const current = generation;
    try {
      const snapshot = await git.snapshot();
      const changes = staged ? snapshot.staged : [...snapshot.changes, ...snapshot.untracked];
      if (current !== generation) return;
      const prefix = locationPrefix(location.directory, snapshot.root);
      const files = path ? changes.filter((file) => file.file === prefix + path) : changes;
      if (!files.length) {
        state.error.value = 'No working-copy diff is available for this selection.';
        return;
      }
      await fw.open(
        `working-diff:${JSON.stringify(location)}:${staged ? 'staged' : 'changes'}:${path ?? 'all'}`,
        {
          component: WorkingDiff,
          props: { files, api: git, snapshot, mode: staged ? 'staged' : 'changes' },
          title: path
            ? `${staged ? 'Staged' : 'Changes'}: ${path}`
            : staged
              ? 'Staged changes'
              : 'All uncommitted changes',
          variant: 'diff',
          closable: true,
          resizable: true,
          focusOnOpen: true,
          scroll: 'manual',
          expiry: Infinity,
          width: 900,
          height: 650,
        },
      );
    } catch (cause) {
      if (current === generation) state.error.value = errorMessage(cause);
    }
  }

  async function load(path: string) {
    const location = scope.value;
    if (!location || pending.has(path)) return;
    const current = generation;
    pending.add(path);
    loading.value = true;
    error.value = '';
    try {
      await fileIndex().load(path);
    } catch (cause) {
      if (current === generation) error.value = errorMessage(cause);
    } finally {
      if (current === generation) {
        pending.delete(path);
        loading.value = pending.size > 0;
      }
    }
  }

  async function toggle(path: string) {
    if (expanded.value.includes(path)) {
      expanded.value = expanded.value.filter((value) => value !== path);
      return;
    }
    expanded.value.push(path);
    if (!findTreeNode(nodes.value, path)?.loaded) await load(path);
  }

  function reset() {
    generation++;
    controller.abort();
    controller = new AbortController();
    index = undefined;
    clearTimeout(publishTimer);
    publishTimer = undefined;
    files.value = [];
    scanning.value = false;
    indexNote.value = '';
    for (const read of reads.values()) read.abort();
    reads.clear();
    pending.clear();
    nodes.value = [];
    loading.value = false;
    error.value = '';
    gitError.value = '';
    gitStatus.value = {};
    branch.value = null;
    diffStats.value = null;
    gitSnapshot.value = null;
    version.value++;
  }

  async function reload() {
    treeStale = false;
    const paths = [...expanded.value].sort((a, b) => a.split('/').length - b.split('/').length);
    reset();
    const current = generation;
    await Promise.all([preload(), loadGit()]);
    for (const path of paths) {
      if (current !== generation) return;
      if (findTreeNode(nodes.value, path)?.type === 'directory') await load(path);
    }
    if (current === generation)
      expanded.value = paths.filter((path) => !!findTreeNode(nodes.value, path));
  }

  async function openFile(path: string, lines?: string) {
    const location = scope.value;
    if (!location) return;
    selectedPath.value = path;
    const current = generation;
    const key = `file-viewer:${JSON.stringify(location)}:${path}:${lines ?? ''}`;
    reads.get(key)?.abort();
    const request = new AbortController();
    reads.set(key, request);
    try {
      const bytes = await state.readFile(location, path, request.signal);
      if (current !== generation || request.signal.aborted) return;
      const content = fileContent(bytes);
      const rawHtml =
        content.fileContent === undefined
          ? `<pre class="shiki"><code>${hexdump(bytes, { color: 'html' })}</code></pre>`
          : undefined;
      await fw.open(key, {
        component: ContentViewer,
        props: {
          path,
          ...content,
          rawHtml,
          lines,
          lang: guessLanguageFromPath(path),
          theme: 'github-dark',
        },
        title: path,
        variant: 'plain',
        width: 800,
        height: 600,
        closable: true,
        resizable: true,
        focusOnOpen: true,
        scroll: 'manual',
        expiry: Infinity,
      });
    } catch (cause) {
      if (current === generation && !request.signal.aborted) {
        error.value = errorMessage(cause);
        state.error.value = error.value;
      }
    } finally {
      if (reads.get(key) === request) reads.delete(key);
    }
  }

  watch(
    () => JSON.stringify([state.ready.value, scope.value]),
    () => {
      for (const entry of fw.entries.value) {
        if (entry.key.startsWith('file-viewer:') || entry.key.startsWith('working-diff:'))
          void fw.close(entry.key);
      }
      reset();
      expanded.value = [];
      selectedPath.value = undefined;
      clearTimeout(refreshTimer);
      if (state.ready.value && scope.value) {
        void preload();
        void loadGit();
      }
    },
    { immediate: true },
  );

  function sameScope(location: { directory: string } | undefined) {
    const directory = scope.value?.directory;
    if (!directory) return false;
    // Events without a Location, or from a parent/child directory of this one, still count.
    if (!location) return true;
    const a = location.directory.replace(/[\\/]$/, '');
    const b = directory.replace(/[\\/]$/, '');
    return (
      a === b ||
      a.startsWith(`${b}/`) ||
      b.startsWith(`${a}/`) ||
      a.startsWith(`${b}\\`) ||
      b.startsWith(`${a}\\`)
    );
  }

  let gitTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleReload() {
    treeStale = true;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      void reload();
    }, 500);
  }
  function scheduleGitRefresh() {
    clearTimeout(gitTimer);
    gitTimer = setTimeout(refreshGit, 400);
  }

  const stopEvents = state.onEvent((event) => {
    if (['filesystem.changed', 'vcs.branch.updated'].includes(event.type)) {
      if (sameScope(event.location)) scheduleReload();
      return;
    }
    // Agent edits: refresh Git status (and the tree when files were added or
    // removed) as soon as a tool finishes, without relying on the file watcher.
    if (event.type === 'session.tool.success' || event.type === 'session.tool.failed') {
      if (!sameScope(event.location)) return;
      const files = event.data.metadata?.files;
      const structural =
        Array.isArray(files) &&
        files.some(
          (file) =>
            !!file && typeof file === 'object' && 'status' in file && file.status !== 'modified',
        );
      if (structural) scheduleReload();
      else scheduleGitRefresh();
      return;
    }
    if (
      event.type === 'session.execution.succeeded' ||
      event.type === 'session.execution.failed' ||
      event.type === 'session.execution.interrupted'
    ) {
      if (sameScope(event.location)) scheduleReload();
    }
  });

  /** Refresh Git status without clearing what is shown. */
  function refreshGit() {
    if (state.ready.value && scope.value) void loadGit();
  }
  /**
   * Back in view: catch up on anything missed while the window was in the
   * background (timers can be throttled there).
   */
  function catchUp() {
    if (document.hidden) return;
    if (treeStale && state.ready.value && scope.value) void reload();
    else refreshGit();
  }
  // Turning the patch on needs one refresh to fetch it.
  watch(includePatch, (value) => {
    if (value) refreshGit();
  });
  window.addEventListener('focus', catchUp);
  document.addEventListener('visibilitychange', catchUp);

  onBeforeUnmount(() => {
    window.removeEventListener('focus', catchUp);
    document.removeEventListener('visibilitychange', catchUp);
    stopEvents();
    clearTimeout(refreshTimer);
    clearTimeout(gitTimer);
    controller.abort();
    clearTimeout(publishTimer);
    for (const read of reads.values()) read.abort();
  });
  return {
    nodes,
    expanded,
    selectedPath,
    loading: computed(() => loading.value || scanning.value),
    error: computed(() =>
      [error.value, gitError.value, indexNote.value].filter(Boolean).join('\n'),
    ),
    gitStatus,
    branch,
    diffStats,
    gitSnapshot,
    includePatch,
    openDiff,
    files,
    version,
    toggle,
    reload,
    refreshGit,
    openFile,
  };
}
