import type { EnrichmentJobRecord } from "@cmg/shared";

import type { EnrichmentService } from "./enrichmentService.js";

interface EnrichmentWorkerOptions {
  pollIntervalMs?: number;
  concurrency?: number;
}

export class EnrichmentWorker {
  private readonly pollIntervalMs: number;
  private readonly concurrency: number;
  private timer: NodeJS.Timeout | null = null;
  private readonly activeStreams = new Set<string>();
  private readonly activeJobs = new Set<string>();
  private isTickRunning = false;

  constructor(
    private readonly enrichmentService: EnrichmentService,
    options: EnrichmentWorkerOptions = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.concurrency = options.concurrency ?? 2;
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce() {
    await this.tick();
  }

  private async tick() {
    if (this.isTickRunning) {
      return;
    }

    this.isTickRunning = true;

    try {
      const jobs = this.enrichmentService.getDueJobs(this.concurrency * 4);

      for (const job of jobs) {
        if (this.activeJobs.size >= this.concurrency) {
          break;
        }

        if (this.activeStreams.has(job.streamId)) {
          continue;
        }

        this.launch(job);
      }
    } finally {
      this.isTickRunning = false;
    }
  }

  private launch(job: EnrichmentJobRecord) {
    const jobKey = `${job.streamId}:${job.nodeId}`;
    this.activeJobs.add(jobKey);
    this.activeStreams.add(job.streamId);

    void this.enrichmentService.processJob(job).finally(() => {
      this.activeJobs.delete(jobKey);
      this.activeStreams.delete(job.streamId);
    });
  }
}
