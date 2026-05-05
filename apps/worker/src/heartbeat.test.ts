import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHeartbeat } from './heartbeat.js';

describe('startHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('logs at the configured interval and stops cleanly', () => {
    const handle = startHeartbeat(1000);
    vi.advanceTimersByTime(2500);
    expect(console.log).toHaveBeenCalledTimes(2);
    handle.stop();
    vi.advanceTimersByTime(5000);
    expect(console.log).toHaveBeenCalledTimes(2);
  });
});
