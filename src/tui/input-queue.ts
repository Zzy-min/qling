export interface SerialInputQueueOptions {
  onError?: (error: unknown, input: string) => void | Promise<void>;
  onQueued?: (event: { pendingCount: number }) => void;
  onRejected?: (event: { pendingCount: number; maxPending: number }) => void;
  maxPending?: number;
}

interface QueuedInput {
  input: string;
  handler: (input: string) => Promise<void>;
  resolve: (accepted: boolean) => void;
}

export class SerialInputQueue {
  private readonly onError?: (error: unknown, input: string) => void | Promise<void>;
  private readonly onQueued?: (event: { pendingCount: number }) => void;
  private readonly onRejected?: (event: { pendingCount: number; maxPending: number }) => void;
  private readonly maxPending: number;
  private readonly queue: QueuedInput[] = [];
  private draining = false;

  constructor(options: SerialInputQueueOptions = {}) {
    this.onError = options.onError;
    this.onQueued = options.onQueued;
    this.onRejected = options.onRejected;
    this.maxPending = Number.isFinite(options.maxPending) && Number(options.maxPending) >= 0
      ? Math.floor(Number(options.maxPending))
      : Number.POSITIVE_INFINITY;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get isProcessing(): boolean {
    return this.draining;
  }

  get maxPendingCount(): number {
    return this.maxPending;
  }

  clearPending(): number {
    const pending = this.queue.splice(0);
    for (const item of pending) {
      item.resolve(false);
    }
    return pending.length;
  }

  enqueue(input: string, handler: (input: string) => Promise<void>): Promise<boolean> {
    const wasBusy = this.draining || this.queue.length > 0;
    if (wasBusy && this.queue.length >= this.maxPending) {
      try {
        this.onRejected?.({ pendingCount: this.queue.length, maxPending: this.maxPending });
      } catch {
        // Backpressure visibility must not affect the active queue.
      }
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      this.queue.push({ input, handler, resolve });
      if (wasBusy) {
        try {
          this.onQueued?.({ pendingCount: this.queue.length });
        } catch {
          // Queue visibility must not affect input delivery.
        }
      }
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) continue;
        try {
          await item.handler(item.input);
        } catch (error) {
          try {
            await this.onError?.(error, item.input);
          } catch {
            // Error reporting must not wedge the input queue.
          }
        } finally {
          item.resolve(true);
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
