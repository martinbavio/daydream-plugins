// Giving the event loop a turn in the middle of long synchronous work. A
// lint that reads a page's elements without ever stopping holds the tab for
// as long as the reading takes (seconds, on a real page): the pointer,
// DevTools and a gate's own timeout all wait for it.

/** How long work runs before it gives the event loop a turn. */
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

// When the event loop last had a turn from here. ONE clock for the whole
// module, not one per read: a lint is a great many short reads (one per
// declaration, each stopping at the first element that differs), and none
// of them alone spends a slice, so only the time since the last turn
// across all of them says when one is due.
let since = performance.now();

/** Called between units of work: a no-op until `SLICE_MS` has passed since
 * the event loop last had a turn, then a turn. A caller that pauses often
 * yields about every `SLICE_MS` and pays nothing on short work. */
export async function pause(): Promise<void> {
  if (performance.now() - since < SLICE_MS) return;
  await turn();
  since = performance.now();
}
