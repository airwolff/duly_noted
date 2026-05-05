const HEARTBEAT_INTERVAL_MS = 60_000;

export interface HeartbeatHandle {
  stop: () => void;
}

export function startHeartbeat(intervalMs: number = HEARTBEAT_INTERVAL_MS): HeartbeatHandle {
  const handle = setInterval(() => {
    console.log(`worker heartbeat ${new Date().toISOString()}`);
  }, intervalMs);

  return {
    stop: () => clearInterval(handle),
  };
}
