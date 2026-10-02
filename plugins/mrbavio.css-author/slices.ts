// Giving the event loop a turn in the middle of a long synchronous read.
// A lint that reads every element of a page in one task holds the tab for
// as long as the read takes (seconds, on a real page): the pointer,
// DevTools and a gate's own timeout all wait for it.

/** How long a read runs before it gives the event loop a turn. A page's
 * every element's full computed style is read here, which on a page of
 * a few thousand elements is seconds of one task: the tab does not
 * answer a pointer, DevTools or the gate's own timer meanwhile. */
export const SLICE_MS = 8;

/** The event loop's next turn, by a message channel: unlike a timer it is
 * neither clamped nor throttled in a tab that is not in front. */
function turn(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** A `pause` for one read: a no-op until the slice is spent, then a turn
 * of the event loop, so a read of many elements yields about every
 * `SLICE_MS` and costs nothing on a short one. */
export function slicer(): () => Promise<void> {
  let from = performance.now();
  return async () => {
    if (performance.now() - from < SLICE_MS) return;
    await turn();
    from = performance.now();
  };
}
