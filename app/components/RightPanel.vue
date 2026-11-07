<template>
  <aside class="right-panel" :class="{ 'is-collapsed': collapsed }">
    <button
      v-if="collapsed"
      type="button"
      class="panel-toggle panel-toggle-collapsed"
      :aria-expanded="false"
      aria-label="Expand activity panel"
      @click="emit('toggle-collapse')"
    >
      <Icon icon="lucide:chevron-left" width="14" height="14" />
    </button>
    <div v-else class="panel-body">
      <div class="panel-header">
        <button
          type="button"
          class="panel-toggle"
          :aria-expanded="true"
          aria-label="Collapse activity panel"
          @click="emit('toggle-collapse')"
        >
          <Icon icon="lucide:chevron-right" width="14" height="14" />
        </button>
        <div class="panel-title">Activity</div>
      </div>

      <section class="panel-section" :class="{ 'is-collapsed': imagesCollapsed }">
        <button
          type="button"
          class="section-header"
          :aria-expanded="!imagesCollapsed"
          @click="emit('toggle-images')"
        >
          <Icon
            :icon="imagesCollapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'"
            width="12"
            height="12"
          />
          <span class="section-title">Recent images</span>
          <span v-if="images.length" class="section-meta">
            {{ shownIndex + 1 }} / {{ images.length }}
          </span>
        </button>
        <div
          v-if="!imagesCollapsed"
          class="images"
          @pointerenter="imagesHovered = true"
          @pointerleave="imagesHovered = false"
        >
          <p v-if="!images.length" class="empty">No images read yet.</p>
          <button
            v-for="(image, index) in images"
            :key="image.key"
            type="button"
            class="image-slide"
            :class="{ 'is-shown': index === shownIndex }"
            :aria-hidden="index !== shownIndex"
            :tabindex="index === shownIndex ? 0 : -1"
            :title="image.name"
            @click="emit('open-image', { url: image.url, filename: image.name })"
          >
            <img :src="image.url" :alt="image.name" />
          </button>
          <div v-if="currentImage" class="image-caption" :title="currentImage.name">
            {{ basename(currentImage.name) }}
          </div>
        </div>
      </section>

      <section class="panel-section panel-section-diff" :class="{ 'is-collapsed': diffCollapsed }">
        <div class="section-header-row">
          <button
            type="button"
            class="section-header"
            :aria-expanded="!diffCollapsed"
            @click="emit('toggle-diff')"
          >
            <Icon
              :icon="diffCollapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'"
              width="12"
              height="12"
            />
            <span class="section-title">{{ gitMode ? 'Git changes' : 'Recent edits' }}</span>
            <span v-if="current" class="section-file" :title="current.file.file">
              {{ basename(current.file.file) }}
            </span>
            <span v-if="current" class="section-stats">
              <span class="additions">+{{ current.file.additions }}</span>
              <span class="deletions">−{{ current.file.deletions }}</span>
              <span v-if="edits.length > 1" class="section-count">
                {{ currentIndex + 1 }} / {{ edits.length }}
              </span>
            </span>
          </button>
          <button
            v-if="!diffCollapsed"
            type="button"
            class="line-number-toggle"
            :class="{ 'is-active': gitMode }"
            :aria-pressed="gitMode"
            :title="
              gitMode
                ? 'Showing all uncommitted Git changes. Click to show recent edits'
                : 'Showing recent edits. Click to show all uncommitted Git changes'
            "
            aria-label="Show Git changes"
            @click="emit('update:gitMode', !gitMode)"
          >
            <Icon icon="lucide:git-compare" width="13" height="13" />
          </button>
          <button
            v-if="!diffCollapsed"
            type="button"
            class="line-number-toggle"
            :class="{ 'is-active': lineNumbers }"
            :aria-pressed="lineNumbers"
            :title="lineNumbers ? 'Hide line numbers' : 'Show line numbers'"
            aria-label="Line numbers"
            @click="lineNumbers = !lineNumbers"
          >
            <Icon icon="lucide:list-ordered" width="13" height="13" />
          </button>
        </div>
        <div
          v-if="!diffCollapsed"
          ref="diffScrollEl"
          class="diff-scroll"
          :class="{ 'no-line-numbers': !lineNumbers }"
        >
          <p v-if="!current" class="empty">
            {{
              !gitMode
                ? 'No edits yet.'
                : gitLoading
                  ? 'Loading Git changes…'
                  : 'No uncommitted changes.'
            }}
          </p>
          <Transition v-else name="diff-swap" mode="out-in">
            <DiffRenderer
              :key="current.key"
              :path="current.file.file"
              :diff-patch="current.file.patch"
              theme="github-dark"
              :gutter-mode="lineNumbers ? 'single' : 'none'"
              :show-loading="false"
              hide-preamble
            />
          </Transition>
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import DiffRenderer from './renderers/DiffRenderer.vue';
import type { RecentFileEdit, RecentImage } from '../composables/useRecentArtifacts';
import { useAutoScroll } from '../composables/useAutoScroll';
import { StorageKeys, storageGet, storageSet } from '../utils/storageKeys';

/** Each image stays up this long before fading to the next. */
const SLIDE_INTERVAL_MS = 1000;

const props = defineProps<{
  collapsed: boolean;
  imagesCollapsed: boolean;
  diffCollapsed: boolean;
  images: RecentImage[];
  /** Recently edited files, newest first (or every Git change, by path, in Git mode). */
  edits: RecentFileEdit[];
  /** Show all uncommitted Git changes instead of the recent edits. */
  gitMode: boolean;
  gitLoading?: boolean;
}>();

const emit = defineEmits<{
  (event: 'toggle-collapse'): void;
  (event: 'toggle-images'): void;
  (event: 'toggle-diff'): void;
  (event: 'open-image', payload: { url: string; filename: string }): void;
  (event: 'update:gitMode', value: boolean): void;
}>();

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

// Images: show the newest on arrival, then cycle through the recent ones.
const shownIndex = ref(0);
const imagesHovered = ref(false);
const currentImage = computed(() => props.images[shownIndex.value]);
watch(
  () => props.images.map((image) => image.key).join('|'),
  () => {
    shownIndex.value = Math.max(0, props.images.length - 1);
  },
  { immediate: true },
);
const slideTimer = setInterval(() => {
  if (props.collapsed || props.imagesCollapsed || imagesHovered.value) return;
  if (props.images.length < 2) return;
  shownIndex.value = (shownIndex.value + 1) % props.images.length;
}, SLIDE_INTERVAL_MS);
onBeforeUnmount(() => clearInterval(slideTimer));

/** Full passes over a file's diff before moving to the next most recent file. */
const PASSES_PER_FILE = 1;

// Diffs: the recently edited files, newest first. Each is scrolled through
// PASSES_PER_FILE times, then the next older one is shown (wrapping around).
// A new edit jumps straight to it.
const diffScrollEl = ref<HTMLElement>();
const lineNumbers = ref(storageGet(StorageKeys.state.rightDiffLineNumbers) !== 'false');
watch(lineNumbers, (value) => storageSet(StorageKeys.state.rightDiffLineNumbers, String(value)));
const currentIndex = ref(0);
let passes = 0;
const current = computed(() => props.edits[currentIndex.value] ?? props.edits[0]);
// Follow the shown file by key as the list changes, and jump straight to any
// entry that is new (a new edit, or a Git change whose diff changed).
watch(
  () => props.edits.map((entry) => entry.key),
  (keys, previous) => {
    const before = new Set(previous ?? []);
    let fresh = previous?.length ? -1 : 0;
    // The newest of the entries that just appeared (order 0 = initial load, not jumped to).
    props.edits.forEach((entry, index) => {
      if (before.has(entry.key) || entry.order <= 0) return;
      if (fresh < 0 || entry.order > (props.edits[fresh]?.order ?? 0)) fresh = index;
    });
    if (fresh >= 0) {
      currentIndex.value = fresh;
      passes = 0;
      return;
    }
    const shown = previous?.[currentIndex.value];
    const index = shown ? keys.indexOf(shown) : -1;
    currentIndex.value =
      index >= 0 ? index : Math.min(currentIndex.value, Math.max(0, keys.length - 1));
  },
);
watch(
  () => props.gitMode,
  () => {
    currentIndex.value = 0;
    passes = 0;
  },
);
useAutoScroll(diffScrollEl, () => current.value?.key, {
  onPass() {
    if (++passes < PASSES_PER_FILE || props.edits.length < 2) return;
    passes = 0;
    currentIndex.value = (currentIndex.value + 1) % props.edits.length;
  },
});
watch(
  () => current.value?.key,
  () => {
    passes = 0;
  },
);
</script>

<style scoped>
.right-panel {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  border: 1px solid #334155;
  border-radius: 12px;
  background-clip: padding-box;
  background: rgba(12, 18, 30, 0.95);
  box-shadow: 0 10px 24px rgba(2, 6, 23, 0.35);
  overflow: hidden;
}
.right-panel.is-collapsed {
  border-color: rgba(100, 116, 139, 0.45);
}

.panel-toggle {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border: 1px solid rgba(100, 116, 139, 0.45);
  border-radius: 6px;
  background: rgba(30, 41, 59, 0.92);
  color: #cbd5e1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.panel-toggle:hover {
  background: rgba(51, 65, 85, 0.95);
}
.panel-toggle-collapsed {
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
}

.panel-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-bottom: 1px solid rgba(71, 85, 105, 0.42);
}
.panel-title {
  color: #cbd5e1;
  font-size: 12px;
}

.panel-section {
  display: flex;
  flex-direction: column;
  flex: 2 1 0;
  min-height: 0;
  border-bottom: 1px solid rgba(71, 85, 105, 0.42);
}
.panel-section-diff {
  flex: 3 1 0;
  border-bottom: 0;
}
.panel-section.is-collapsed {
  flex: 0 0 auto;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 6px 8px;
  border: 0;
  background: rgba(15, 23, 42, 0.6);
  color: #94a3b8;
  font: inherit;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}
.section-header:hover {
  color: #e2e8f0;
}
.section-header:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: -2px;
}
.section-title {
  font-weight: 600;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.section-meta,
.section-file {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #64748b;
}
.section-meta {
  margin-left: auto;
}
.section-stats {
  display: flex;
  gap: 6px;
  margin-left: auto;
  white-space: nowrap;
}
.additions {
  color: #4ade80;
}
.deletions {
  color: #f87171;
}

.empty {
  margin: auto;
  padding: 12px;
  color: #64748b;
  font-size: 11px;
  text-align: center;
}

.section-header-row {
  display: flex;
  align-items: stretch;
  background: rgba(15, 23, 42, 0.6);
}
.section-header-row .section-header {
  flex: 1;
  background: transparent;
}
.line-number-toggle {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  margin: 3px 6px 3px 0;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
}
.line-number-toggle:hover {
  color: #e2e8f0;
  background: rgba(51, 65, 85, 0.6);
}
.line-number-toggle.is-active {
  color: #93c5fd;
  border-color: rgba(96, 165, 250, 0.35);
}
.line-number-toggle:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: -2px;
}

/* Images: stacked slides that crossfade. */
.images {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.image-slide {
  position: absolute;
  inset: 8px 8px 26px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: zoom-in;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.4s ease-in-out;
}
.image-slide.is-shown {
  opacity: 1;
  pointer-events: auto;
}
.image-slide img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.image-caption {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #64748b;
  font-size: 10px;
  text-align: center;
}

/* Diff: one container for the whole edit, scrolled only automatically. */
.diff-scroll {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  --term-font-size: 11px;
  font-family: var(--term-font-family);
  font-size: var(--term-font-size);
  display: flex;
  flex-direction: column;
}
.section-count {
  color: #64748b;
}
.diff-swap-enter-active,
.diff-swap-leave-active {
  transition: opacity 0.25s ease;
}
.diff-swap-enter-from,
.diff-swap-leave-to {
  opacity: 0;
}
/* No "@@ -a,b +c,d @@" hunk headers; a thin divider marks skipped lines instead. */
.diff-scroll :deep(.hunk-header) {
  display: none;
}
.diff-scroll :deep(.diff-document > section + section) {
  margin-top: 6px;
  border-top: 1px dashed rgba(100, 116, 139, 0.45);
  padding-top: 6px;
}
.diff-scroll.no-line-numbers :deep(.code-content code) {
  grid-template-columns: 1fr;
}
.diff-scroll :deep(.diff-renderer-content) {
  height: auto;
}
.diff-scroll :deep(.viewer-viewport),
.diff-scroll :deep(.viewer-body) {
  flex: none;
  overflow: visible;
}

@media (prefers-reduced-motion: reduce) {
  .image-slide {
    transition: none;
  }
}
</style>
