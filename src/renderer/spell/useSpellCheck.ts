// Phase 82 — the spell-check state hook.
//
// Owns the renderer-visible spell-check state (enabled / status / dictionary)
// and loads the dictionary lazily, ONCE, only while spell check is enabled.
// The actual loading + caching lives in `spellClient`; this hook just projects
// it onto React state and exposes a `setEnabled` that reports the flip to the
// host (which persists the preference).

import { useCallback, useEffect, useRef, useState } from "react";
import type { DictionaryLoadError } from "../../shared/ipc";
import { loadSpellDictionary } from "./spellClient";

export type SpellCheckStatus = "off" | "loading" | "ready" | "error";

export interface SpellCheckState {
  enabled: boolean;
  status: SpellCheckStatus;
  dictionary: Set<string> | null;
  error: DictionaryLoadError | null;
  setEnabled: (enabled: boolean) => void;
}

export function useSpellCheck(args: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}): SpellCheckState {
  const { enabled, onEnabledChange } = args;
  const [status, setStatus] = useState<SpellCheckStatus>(enabled ? "loading" : "off");
  const [dictionary, setDictionary] = useState<Set<string> | null>(null);
  const [error, setError] = useState<DictionaryLoadError | null>(null);
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setStatus("off");
      return;
    }
    if (dictionary !== null) {
      setStatus("ready");
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    setStatus("loading");
    void loadSpellDictionary().then((result) => {
      if (!mountedRef.current) return;
      if (result.dictionary !== null) {
        setDictionary(result.dictionary);
        setError(null);
        setStatus("ready");
      } else {
        setError(result.error);
        setStatus("error");
      }
    });
  }, [enabled, dictionary]);

  const setEnabled = useCallback(
    (next: boolean): void => {
      onEnabledChange(next);
    },
    [onEnabledChange],
  );

  return { enabled, status, dictionary, error, setEnabled };
}