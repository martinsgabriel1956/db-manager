import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { commands } from "@/bindings";

/** Lines kept in memory; older ones are dropped. */
export const LIVE_LIMIT = 1000;
const FLUSH_MS = 200;

export type LiveLine<T> = T & { seq: number; receivedAt: Date };

/**
 * A live feed (pub/sub messages, MONITOR lines) that can arrive faster than the
 * screen draws: arrivals are buffered and drawn every FLUSH_MS, keeping the last
 * `LIVE_LIMIT`. Paused, the view freezes and arrivals wait in the buffer (same
 * limit) until resumed.
 */
export function useLiveLog<T>() {
  const pending = useRef<LiveLine<T>[]>([]);
  const seq = useRef(0);
  const [lines, setLines] = useState<LiveLine<T>[]>([]);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) {
      return;
    }
    const timer = setInterval(() => {
      if (pending.current.length === 0) {
        return;
      }
      const batch = pending.current;
      pending.current = [];
      setLines(prev => [...prev, ...batch].slice(-LIVE_LIMIT));
    }, FLUSH_MS);
    return () => clearInterval(timer);
  }, [paused]);

  const push = useCallback((line: T) => {
    seq.current += 1;
    pending.current.push({ ...line, seq: seq.current, receivedAt: new Date() });
    if (pending.current.length > LIVE_LIMIT) {
      pending.current.splice(0, pending.current.length - LIVE_LIMIT);
    }
  }, []);

  const clear = useCallback(() => {
    pending.current = [];
    setLines([]);
  }, []);

  return { lines, paused, setPaused, push, clear };
}

export function clock(date: Date): string {
  return date.toLocaleTimeString("pt-BR", { hour12: false, fractionalSecondDigits: 3 });
}

export type LiveStatus =
  { state: "idle" } | { state: "running" } | { state: "ended"; reason: string };

/**
 * One live backend session (pub/sub, MONITOR) on a dedicated connection. It ends
 * on `stop`, when the panel unmounts (section or tab closed) and when the
 * connection closes (the backend sends `ended`).
 */
export function useLiveSession<E extends { kind: string }>(
  connectionId: string,
  onEvent: (event: E) => void
) {
  const current = useRef<{ connectionId: string; sessionId: string } | null>(null);
  const [status, setStatus] = useState<LiveStatus>({ state: "idle" });

  const stop = useCallback(() => {
    const session = current.current;
    current.current = null;
    setStatus({ state: "idle" });
    if (session) {
      commands.stopRedisSession(session.connectionId, session.sessionId).catch(() => undefined);
    }
  }, []);

  useEffect(() => stop, [stop]);

  /** `open` starts the backend session on the channel; false = it did not start */
  async function start(open: (sessionId: string, channel: Channel<E>) => Promise<boolean>) {
    stop();
    const sessionId = crypto.randomUUID();
    const channel = new Channel<E>(event => {
      if (current.current?.sessionId !== sessionId) {
        return;
      }
      if (event.kind === "ended") {
        current.current = null;
        setStatus({ state: "ended", reason: (event as unknown as { reason: string }).reason });
      } else {
        onEvent(event);
      }
    });
    current.current = { connectionId, sessionId };
    setStatus({ state: "running" });
    try {
      if (!(await open(sessionId, channel))) {
        stop();
      }
    } catch (err) {
      if (current.current?.sessionId === sessionId) {
        current.current = null;
        setStatus({ state: "idle" });
      }
      throw err;
    }
  }

  return { status, start, stop };
}
