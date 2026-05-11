import type { RunDeps, RunOutcome } from './pipeline/run.js';
import { runPipelineOnce } from './pipeline/run.js';

const DEFAULT_INTERVAL_MS = 5000;

export interface PollLoopHandle {
  stop: () => Promise<void>;
}

export interface PollLoopOptions {
  intervalMs?: number;
  onError?: (err: unknown) => void;
}

function logOutcome(outcome: RunOutcome): void {
  switch (outcome.kind) {
    case 'idle':
      console.log(`worker tick ${new Date().toISOString()} no work`);
      return;
    case 'submitted':
      console.log(
        `worker tick ${new Date().toISOString()} submitted meeting=${outcome.meetingId} transcript=${outcome.transcriptId}`,
      );
      return;
    case 'segmented':
      console.log(
        `worker tick ${new Date().toISOString()} segmented meeting=${outcome.meetingId} segments=${outcome.segmentCount}`,
      );
      return;
    case 'summarized':
      console.log(
        `worker tick ${new Date().toISOString()} summarized meeting=${outcome.meetingId}`,
      );
      return;
    case 'embedded':
      console.log(
        `worker tick ${new Date().toISOString()} embedded meeting=${outcome.meetingId} segments=${outcome.segmentCount}`,
      );
      return;
    case 'failed':
      console.error(
        `worker tick ${new Date().toISOString()} failed meeting=${outcome.meetingId} message=${outcome.message}`,
      );
      return;
  }
}

/**
 * Continuous poll loop. Calls runPipelineOnce on each tick. The loop runs
 * sequentially — at most one meeting in flight per worker at a time, which
 * is what the Stage 1 throughput target needs (~6 meetings/day).
 */
export function startPollLoop(deps: RunDeps, options: PollLoopOptions = {}): PollLoopHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let activeTick: Promise<void> = Promise.resolve();

  const tick = async (): Promise<void> => {
    try {
      const outcome = await runPipelineOnce(deps);
      logOutcome(outcome);
    } catch (err) {
      if (options.onError) {
        options.onError(err);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`worker tick error ${new Date().toISOString()} ${message}`);
      }
    } finally {
      if (!stopping) {
        timer = setTimeout(() => {
          activeTick = tick();
        }, intervalMs);
      }
    }
  };

  activeTick = tick();

  return {
    stop: async () => {
      stopping = true;
      if (timer) clearTimeout(timer);
      await activeTick;
    },
  };
}
