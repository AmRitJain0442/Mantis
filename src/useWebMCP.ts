import { useCallback, useEffect, useRef, useState } from "react";
import {
  modelContext, registerFlowTraceTools,
  type DiscoveredTool, type ToolResult
} from "./webmcp";

export type Connection = "connecting" | "native" | "preview";

/** Registers FlowTrace's tools, then keeps a live view of what is actually
 *  registered by re-reading `getTools()` whenever the browser fires
 *  `toolchange`. Aborting the registration controller on teardown unregisters
 *  every tool this page added. */
export function useWebMCP() {
  const [connection, setConnection] = useState<Connection>("connecting");
  const [registered, setRegistered] = useState<DiscoveredTool[]>([]);
  const [lastCall, setLastCall] = useState<{ name: string; ms: number; ok: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRegistered(await modelContext().getTools());
    } catch {
      setRegistered([]);
    }
  }, []);

  useEffect(() => {
    let live = true;
    let detach: (() => void) | undefined;

    registerFlowTraceTools().then((state) => {
      if (!live) {
        state.controller.abort();
        return;
      }
      abortRef.current = state.controller;
      setConnection(state.supported ? "native" : "preview");
      void refresh();

      const native = document.modelContext;
      if (native?.addEventListener) {
        const onChange = () => void refresh();
        native.addEventListener("toolchange", onChange);
        detach = () => native.removeEventListener?.("toolchange", onChange);
      }
    });

    return () => {
      live = false;
      detach?.();
      abortRef.current?.abort();
    };
  }, [refresh]);

  /** Run a tool the way an agent would: discover it, then execute it through
   *  the model context rather than reaching into the module directly. */
  const call = useCallback(async (
    name: string,
    input: Record<string, unknown> = {},
    options?: { signal?: AbortSignal }
  ): Promise<ToolResult> => {
    const context = modelContext();
    const tool = (await context.getTools()).find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Tool not registered: ${name}`);
    const started = performance.now();
    try {
      const outcome = await context.executeTool(tool, input, options);
      setLastCall({ name, ms: Math.round(performance.now() - started), ok: !outcome.isError });
      return outcome;
    } catch (error) {
      setLastCall({ name, ms: Math.round(performance.now() - started), ok: false });
      throw error;
    }
  }, []);

  return { connection, registered, call, refresh, lastCall };
}
