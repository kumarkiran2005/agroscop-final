/**
 * AgroGuide Autopilot — action registry.
 *
 * A screen registers its REAL handlers while mounted; Autopilot can then only
 * ever call something a mounted screen deliberately exposed. Local `useState`
 * in those screens is untouched — we call their existing setters.
 *
 * REFERENCE MAP
 *   Replicates: talbotiq-platform/src/features/guide/autopilot/registry.ts
 *   Difference: the reference uses a zustand store. AgroScope has no zustand
 *   dependency and the brief says not to add libraries, so this is the same
 *   store shape built on React 18's useSyncExternalStore. The pure selectors
 *   (listDescriptors / snapshotState / findAction) and the useAutopilotActions
 *   register-on-mount / unregister-on-unmount contract are identical.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { ActionDescriptor, ParamSpec } from "./types";

export interface RegisteredAction {
  descriptor: ActionDescriptor;
  run: (args: Record<string, unknown>) => void | Promise<void>;
}

/** What a screen passes per action (the map key is the name; screen prefixes it). */
export interface ActionDef {
  description: string;
  sideEffect?: boolean;
  params?: ParamSpec[];
  run: (args: Record<string, unknown>) => void | Promise<void>;
}

interface ScreenReg {
  actions: Record<string, RegisteredAction>;
  getState: () => Record<string, unknown>;
}

export interface RegistryState {
  byScreen: Record<string, ScreenReg>;
}

/* ── Minimal external store (zustand-equivalent, no dependency) ───────────── */

let state: RegistryState = { byScreen: {} };
const listeners = new Set<() => void>();

function setState(next: RegistryState): void {
  state = next;
  listeners.forEach((l) => l());
}

export const autopilotRegistry = {
  getState: (): RegistryState => state,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  registerScreen: (
    screen: string,
    defs: Record<string, ActionDef>,
    getState?: () => Record<string, unknown>
  ): void => {
    const actions: Record<string, RegisteredAction> = {};
    for (const [key, def] of Object.entries(defs)) {
      const name = `${screen}.${key}`;
      actions[name] = {
        descriptor: {
          name,
          description: def.description,
          screen,
          sideEffect: def.sideEffect ?? false,
          params: def.params ?? [],
        },
        run: def.run,
      };
    }
    setState({
      byScreen: {
        ...state.byScreen,
        [screen]: { actions, getState: getState ?? (() => ({})) },
      },
    });
  },
  unregisterScreen: (screen: string): void => {
    const next = { ...state.byScreen };
    delete next[screen];
    setState({ byScreen: next });
  },
};

/* ── Pure selectors ──────────────────────────────────────────────────────── */

export function listDescriptors(s: RegistryState): ActionDescriptor[] {
  return Object.values(s.byScreen).flatMap((sc) =>
    Object.values(sc.actions).map((a) => a.descriptor)
  );
}

export function snapshotState(s: RegistryState): Record<string, unknown> {
  return Object.values(s.byScreen).reduce<Record<string, unknown>>(
    (acc, sc) => ({ ...acc, ...sc.getState() }),
    {}
  );
}

export function findAction(s: RegistryState, name: string): RegisteredAction | undefined {
  for (const sc of Object.values(s.byScreen)) {
    if (sc.actions[name]) return sc.actions[name];
  }
  return undefined;
}

/* ── Hooks ───────────────────────────────────────────────────────────────── */

/** Subscribe a component to registry changes (used by the panel to list actions). */
export function useAutopilotRegistry(): RegistryState {
  return useSyncExternalStore(
    autopilotRegistry.subscribe,
    autopilotRegistry.getState,
    autopilotRegistry.getState
  );
}

/**
 * Screens call this while mounted to expose their real handlers to Autopilot.
 * Callers MUST memoize `defs` and `opts.getState` (useMemo/useCallback) or the
 * effect re-registers on every render.
 */
export function useAutopilotActions(
  screen: string,
  defs: Record<string, ActionDef>,
  opts?: { getState?: () => Record<string, unknown> }
): void {
  const getState = opts?.getState;
  useEffect(() => {
    autopilotRegistry.registerScreen(screen, defs, getState);
    return () => autopilotRegistry.unregisterScreen(screen);
  }, [screen, defs, getState]);
}

/**
 * Stable helper for screens that want an inline, always-fresh getState: the
 * returned identity never changes (so it won't re-trigger registration), but it
 * always calls the LATEST closure, so it reads current props/state.
 */
export function useStableGetState(
  fn: () => Record<string, unknown>
): () => Record<string, unknown> {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback(() => ref.current(), []);
}
