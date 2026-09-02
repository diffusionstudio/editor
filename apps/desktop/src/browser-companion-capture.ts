/**
 * One explicitly armed, root-scoped capture. A published value is retained
 * only until its consumer takes it (or the deadline expires); publications
 * while no capture is armed are ignored and retain nothing.
 */
export class OneShotCapture<T> {
  private pending: {
    key: string;
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
    published: boolean;
    taken: boolean;
  } | null = null;

  arm(key: string, timeoutMs: number, timeoutMessage: string): void {
    this.cancel("Companion bundle capture was superseded");

    let resolveCapture!: (value: T) => void;
    let rejectCapture!: (error: Error) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolveCapture = resolve;
      rejectCapture = reject;
    });
    // A prepare/start client can disappear before consuming the capture.
    // Keep that bounded rejection from becoming an unhandled process error.
    void promise.catch(() => {});

    const capture = {
      key,
      promise,
      resolve: resolveCapture,
      reject: rejectCapture,
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
      published: false,
      taken: false,
    };
    capture.timer = setTimeout(() => {
      if (this.pending !== capture) return;
      this.pending = null;
      capture.reject(new Error(timeoutMessage));
    }, timeoutMs);
    this.pending = capture;
  }

  isArmedFor(key: string): boolean {
    return this.pending?.key === key && !this.pending.published;
  }

  publish(key: string, value: T): boolean {
    const capture = this.pending;
    if (!capture || capture.key !== key || capture.published) return false;
    capture.published = true;
    capture.resolve(value);
    if (capture.taken) this.release(capture);
    return true;
  }

  take(key: string): Promise<T> {
    const capture = this.pending;
    if (!capture || capture.key !== key || capture.taken) {
      return Promise.reject(new Error("No canonical renderer bundle capture is armed for this project"));
    }
    capture.taken = true;
    if (capture.published) this.release(capture);
    return capture.promise;
  }

  cancel(message = "Companion bundle capture was cancelled"): void {
    const capture = this.pending;
    if (!capture) return;
    this.release(capture);
    capture.reject(new Error(message));
  }

  inspect(): { armed: boolean; retainedValues: number } {
    return {
      armed: !!this.pending && !this.pending.published,
      retainedValues: this.pending?.published ? 1 : 0,
    };
  }

  private release(capture: NonNullable<OneShotCapture<T>["pending"]>): void {
    if (this.pending === capture) this.pending = null;
    clearTimeout(capture.timer);
  }
}
