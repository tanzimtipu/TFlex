// DEF-416 — the detached-window adopt payload must survive a late renderer
// subscription. Main pushes `tab:adopt` once the child window finishes loading,
// but the renderer only calls `onAdopt` from a React `useEffect`, which can run
// AFTER `did-finish-load`. A listener registered only at subscribe time would
// miss that push entirely, leaving a blank orphan window.
//
// The preload registers ONE persistent IPC listener at load and records every
// payload here. Until a consumer subscribes, payloads queue; on subscribe the
// queue is replayed in order exactly once, and later payloads stream straight
// through. Delivery is therefore independent of renderer mount timing. Pure
// (no electron import) so the unit tests can drive it directly.

export interface AdoptBuffer<T> {
  /** Record a payload pushed by main. A subscribed consumer receives it
   *  straight through; otherwise it is queued for replay on the next
   *  `subscribe`. */
  push(payload: T): void;
  /** Register the single consumer and replay every queued payload, in order,
   *  exactly once. Returns an unsubscribe function; buffering resumes once it
   *  runs. */
  subscribe(consumer: (payload: T) => void): () => void;
}

export function createAdoptBuffer<T>(): AdoptBuffer<T> {
  const queue: T[] = [];
  let consumer: ((payload: T) => void) | null = null;

  return {
    push(payload: T): void {
      if (consumer !== null) {
        consumer(payload);
        return;
      }
      queue.push(payload);
    },
    subscribe(next: (payload: T) => void): () => void {
      consumer = next;
      const pending = queue.splice(0, queue.length);
      for (const payload of pending) {
        next(payload);
      }
      return () => {
        if (consumer === next) {
          consumer = null;
        }
      };
    },
  };
}
