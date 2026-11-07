import { onBeforeUnmount, ref, watch, type Ref } from 'vue';
import type { OpenCodeEvent } from '@opencode/client';

export const AUTO_CONTINUE_MESSAGE = 'continue';
/** Pause after a run finishes, so the state settles and the user can react. */
export const AUTO_CONTINUE_DELAY_MS = 1500;

/**
 * Send "continue" whenever the selected session finishes a run successfully.
 *
 * Auto continue and the input panel are mutually exclusive: an open input
 * panel means the user wants to write the next message, so showing the panel
 * turns auto continue off, and turning auto continue on hides the panel.
 * Hiding the panel never turns auto continue on. Failed or interrupted runs
 * (e.g. Stop) never trigger a continue.
 */
export function useAutoContinue(options: {
  inputVisible: Ref<boolean>;
  onEvent: (listener: (event: OpenCodeEvent) => void) => () => void;
  /** Whether a continue may be sent to this session right now. */
  canContinue: (sessionID: string) => boolean;
  /** Send the continue message; resolves to whether it was sent. */
  send: (sessionID: string, text: string) => Promise<boolean>;
  delayMs?: number;
}) {
  const enabled = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancel() {
    clearTimeout(timer);
    timer = undefined;
  }

  watch(options.inputVisible, (visible) => {
    if (visible) enabled.value = false;
  });
  watch(enabled, (on) => {
    if (on) options.inputVisible.value = false;
    else cancel();
  });

  const stopEvents = options.onEvent((event) => {
    if (event.type !== 'session.execution.succeeded') return;
    if (!enabled.value || options.inputVisible.value) return;
    const sessionID = event.data.sessionID;
    cancel();
    timer = setTimeout(async () => {
      timer = undefined;
      if (!enabled.value || options.inputVisible.value || !options.canContinue(sessionID)) return;
      // Stop instead of retrying if the message cannot be sent.
      if (!(await options.send(sessionID, AUTO_CONTINUE_MESSAGE))) enabled.value = false;
    }, options.delayMs ?? AUTO_CONTINUE_DELAY_MS);
  });

  onBeforeUnmount(() => {
    stopEvents();
    cancel();
  });

  return { enabled };
}
