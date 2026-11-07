import { computed, shallowRef } from 'vue';
import type { FileDiffInfo, SessionMessageAssistantTool } from '@opencode/client';
import { toolOutput } from '../utils/protocol/tool-output';

export type RecentImage = { key: string; url: string; name: string; order: number };
/** One edited file's latest diff. */
export type RecentFileEdit = { key: string; file: FileDiffInfo; order: number };

/** How many of the most recently read images are kept for the slideshow. */
const MAX_IMAGES = 12;
/** How many recently edited files the diff view cycles through. */
const MAX_FILES = 10;

/**
 * The most recent images the agent read and the most recently edited files, for
 * the activity panel. Items are ordered by their message's time rather than
 * arrival, so older history loaded later never displaces newer activity.
 */
export function useRecentArtifacts() {
  const images = shallowRef<RecentImage[]>([]);
  const edits = shallowRef<RecentFileEdit[]>([]);
  const seen = new Set<string>();

  /** Record a tool call; only completed reads with images and edits matter. */
  function record(key: string, order: number, tool: SessionMessageAssistantTool) {
    if (tool.state.status !== 'completed' || seen.has(key)) return;
    if (!['read', 'edit', 'patch'].includes(tool.name)) return;
    let output;
    try {
      output = toolOutput(tool);
    } catch {
      return;
    }
    seen.add(key);
    if (tool.name === 'read') {
      const input = tool.state.input;
      const readPath =
        typeof input === 'object' && typeof input.path === 'string' ? input.path : undefined;
      const found = output.media
        .filter((file) => file.mime.startsWith('image/') && file.uri.startsWith('data:image/'))
        .map((file, index) => ({
          key: `${key}:${index}`,
          url: file.uri,
          name: file.name ?? readPath ?? 'image',
          order: order + index / 1000,
        }));
      if (found.length)
        images.value = [...images.value, ...found]
          .sort((a, b) => a.order - b.order)
          .slice(-MAX_IMAGES);
    } else if (output.files.length) {
      // Newest first, one entry per file (its latest diff).
      const byFile = new Map(edits.value.map((entry) => [entry.file.file, entry]));
      output.files.forEach((file, index) => {
        const entry = { key: `${key}:${index}`, file, order: order + index / 1e6 };
        const existing = byFile.get(file.file);
        if (!existing || entry.order > existing.order) byFile.set(file.file, entry);
      });
      edits.value = [...byFile.values()].sort((a, b) => b.order - a.order).slice(0, MAX_FILES);
    }
  }

  function reset() {
    images.value = [];
    edits.value = [];
    seen.clear();
  }

  return {
    images: computed(() => images.value),
    edits: computed(() => edits.value),
    record,
    reset,
  };
}
