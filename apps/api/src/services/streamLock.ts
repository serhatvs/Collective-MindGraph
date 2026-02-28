export class StreamLock {
  private readonly queues = new Map<string, Promise<void>>();

  async runExclusive<T>(streamId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(streamId) ?? Promise.resolve();

    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    const queued = previous.then(() => current);
    this.queues.set(streamId, queued);
    await previous;

    try {
      return await action();
    } finally {
      release();

      if (this.queues.get(streamId) === queued) {
        this.queues.delete(streamId);
      }
    }
  }
}
