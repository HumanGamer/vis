import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import type { useFloatingWindows } from './useFloatingWindows';
import { StorageKeys, storageGet, storageSet } from '../utils/storageKeys';

export function useWorkspaceLayout(
  elements: {
    header: Ref<HTMLElement | undefined>;
    body: Ref<HTMLElement | undefined>;
    side: Ref<HTMLElement | undefined>;
    right?: Ref<HTMLElement | undefined>;
    output: Ref<HTMLElement | undefined>;
    input: Ref<HTMLElement | undefined>;
    canvas: Ref<HTMLElement | undefined>;
  },
  fw: ReturnType<typeof useFloatingWindows>,
) {
  const inputHeight = ref<number | null>(null);
  const sidePanelWidth = ref<number | null>(null);
  const rightPanelWidth = ref<number | null>(null);
  const rightPanelCollapsed = ref(storageGet(StorageKeys.state.rightPanelCollapsed) === 'true');
  watch(rightPanelCollapsed, (value) =>
    storageSet(StorageKeys.state.rightPanelCollapsed, String(value)),
  );
  const mobileQuery = window.matchMedia('(max-width: 768px)');
  const isMobile = ref(mobileQuery.matches);
  const mobileSideOpen = ref(false);
  const desktopSideCollapsed = ref(storageGet(StorageKeys.state.sidePanelCollapsed) === 'true');
  const sidePanelCollapsed = computed({
    get: () => (isMobile.value ? !mobileSideOpen.value : desktopSideCollapsed.value),
    set: (value: boolean) => {
      if (isMobile.value) mobileSideOpen.value = !value;
      else desktopSideCollapsed.value = value;
    },
  });
  function changeLayout() {
    isMobile.value = mobileQuery.matches;
    mobileSideOpen.value = false;
    void nextTick(syncExtent);
  }
  mobileQuery.addEventListener('change', changeLayout);
  let resizing:
    | { axis: 'input' | 'side' | 'right'; start: number; size: number; min: number; max: number }
    | undefined;
  const observer = new ResizeObserver(syncExtent);

  function syncExtent() {
    const canvas = elements.canvas.value;
    const header = elements.header.value;
    const input = elements.input.value;
    if (!canvas || !header || !input) return;
    if (isMobile.value) {
      fw.setAvoid([]);
      canvas.style.removeProperty('--canvas-top');
      canvas.style.removeProperty('--canvas-height');
      fw.setExtent(canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height);
      return;
    }
    const top = Math.max(0, header.getBoundingClientRect().bottom);
    // A hidden input panel has no box; the canvas then ends with the output area.
    const bottom = input.getClientRects().length
      ? input.getBoundingClientRect().top
      : (elements.output.value?.getBoundingClientRect().bottom ?? top);
    const height = Math.max(0, bottom - top);
    canvas.style.setProperty('--canvas-top', `${top}px`);
    canvas.style.setProperty('--canvas-height', `${height}px`);
    fw.setExtent(canvas.getBoundingClientRect().width, height);
    // Keep new floating windows off the right panel unless nothing else fits.
    const right = elements.right?.value?.getBoundingClientRect();
    const left = canvas.getBoundingClientRect().left;
    fw.setAvoid(
      right && right.width > 0
        ? [{ x: right.left - left, y: right.top - top, width: right.width, height: right.height }]
        : [],
    );
  }

  // The output area resizes whenever the header or input panel is shown or hidden.
  watch(
    [elements.header, elements.input, elements.body, elements.output, elements.right ?? ref()],
    (values) => {
      observer.disconnect();
      for (const el of values) if (el) observer.observe(el);
      void nextTick(syncExtent);
    },
  );
  watch(desktopSideCollapsed, (value) =>
    storageSet(StorageKeys.state.sidePanelCollapsed, String(value)),
  );

  function startInputResize(event: PointerEvent) {
    if (event.button !== 0 || !elements.input.value || !elements.output.value) return;
    const size = elements.input.value.getBoundingClientRect().height;
    const total = size + elements.output.value.getBoundingClientRect().height;
    const max = Math.max(120, total - 180);
    resizing = { axis: 'input', start: event.clientY, size, min: Math.min(200, max), max };
    inputHeight.value = size;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function startSidePanelResize(event: PointerEvent) {
    if (event.button !== 0 || !elements.side.value || !elements.body.value) return;
    const size = elements.side.value.getBoundingClientRect().width;
    resizing = {
      axis: 'side',
      start: event.clientX,
      size,
      min: 160,
      max: Math.max(160, elements.body.value.getBoundingClientRect().width * 0.5 - 10),
    };
    sidePanelWidth.value = size;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function startRightPanelResize(event: PointerEvent) {
    const right = elements.right?.value;
    if (event.button !== 0 || !right || !elements.body.value) return;
    const size = right.getBoundingClientRect().width;
    resizing = {
      axis: 'right',
      start: event.clientX,
      size,
      min: 200,
      max: Math.max(200, elements.body.value.getBoundingClientRect().width * 0.5 - 10),
    };
    rightPanelWidth.value = size;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function move(event: PointerEvent) {
    if (!resizing) return;
    const delta =
      resizing.axis === 'input'
        ? resizing.start - event.clientY
        : resizing.axis === 'right'
          ? resizing.start - event.clientX
          : event.clientX - resizing.start;
    const size = Math.max(resizing.min, Math.min(resizing.max, resizing.size + delta));
    if (resizing.axis === 'input') inputHeight.value = size;
    else if (resizing.axis === 'right') rightPanelWidth.value = size;
    else sidePanelWidth.value = size;
    void nextTick(syncExtent);
  }
  function end() {
    resizing = undefined;
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('resize', syncExtent);
  onBeforeUnmount(() => {
    mobileQuery.removeEventListener('change', changeLayout);
    observer.disconnect();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('resize', syncExtent);
  });
  return {
    isMobile,
    inputHeight,
    sidePanelWidth,
    sidePanelCollapsed,
    rightPanelWidth,
    rightPanelCollapsed,
    startInputResize,
    startSidePanelResize,
    startRightPanelResize,
    syncExtent,
  };
}
