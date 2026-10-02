// Phase 82 — the reusable spell-check text surface.
//
// Wraps a real <textarea> with an aria-hidden MIRROR layer that paints red
// wavy underlines under the misspelled tokens, plus a right-click suggestion
// popover. The textarea stays the single interactive element (keystrokes,
// selection, IME, accessibility all unchanged): the mirror is pointer-events
// none and its text is transparent, so only the underlines are visible.
//
// Checking is debounced (~150ms) so tokenising never runs synchronously on
// every keystroke. The mirror typography is copied from the textarea's own
// computed style, so underlines land on the glyphs regardless of the surface
// (Inspector field, on-canvas run editor).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import {
  SPELL_SUGGESTION_LIMIT,
  isSpellMisspelled,
  suggestSpellCorrections,
  tokenizeForSpell,
  type SpellToken,
} from "../../shared/spell";
import type { SpellCheckState } from "./useSpellCheck";

/** Idle delay before a value change is tokenised. */
const DEBOUNCE_MS = 150;

const MISSPELLED_STYLE: CSSProperties = {
  textDecoration: "underline",
  textDecorationStyle: "wavy",
  textDecorationColor: "#e5484d",
};

const MIRROR_BASE: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  overflow: "hidden",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  color: "transparent",
};

export interface SpellCheckTextareaProps {
  value: string;
  spellCheck: Omit<SpellCheckState, "setEnabled">;
  className?: string;
  textareaAttrs?: Record<string, string>;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  style?: CSSProperties;
  inputRef?: Ref<HTMLTextAreaElement>;
  onFocus?: (e: FocusEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Preserved from the on-canvas editor so a pointerdown on the field never
   *  bubbles into the overlay's selection/drag handlers. */
  onPointerDown?: (e: ReactPointerEvent<HTMLTextAreaElement>) => void;
  onChange: (text: string) => void;
  onCommit?: (relatedTarget?: EventTarget | null) => void;
}

/** The token whose span contains `offset` (end-exclusive, but a caret resting
 *  just after the last glyph still counts). */
function tokenAtOffset(offset: number, tokens: readonly SpellToken[]): SpellToken | null {
  for (const token of tokens) {
    if (offset >= token.start && offset <= token.end) return token;
  }
  return null;
}

interface PopoverState {
  token: SpellToken;
  suggestions: string[];
  x: number;
  y: number;
}

/** Build the mirror's children: plain transparent text with a misspelled span
 *  around each flagged token. */
function buildMirror(text: string, misspelled: readonly SpellToken[]): ReactNode {
  if (misspelled.length === 0) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const token of misspelled) {
    if (token.start > cursor) parts.push(text.slice(cursor, token.start));
    parts.push(
      <span key={`spell-${key++}`} data-spell-misspelled style={MISSPELLED_STYLE}>
        {text.slice(token.start, token.end)}
      </span>,
    );
    cursor = token.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function SpellCheckTextarea(props: SpellCheckTextareaProps): ReactElement {
  const {
    value,
    spellCheck,
    className,
    textareaAttrs,
    rows,
    placeholder,
    disabled,
    ariaLabel,
    style,
    inputRef,
    onFocus,
    onKeyDown,
    onPointerDown,
    onChange,
    onCommit,
  } = props;

  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const mirrorKeyRef = useRef("");
  const [debouncedValue, setDebouncedValue] = useState(value);
  const [mirrorStyle, setMirrorStyle] = useState<CSSProperties>(MIRROR_BASE);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const setTaRef = useCallback(
    (el: HTMLTextAreaElement | null): void => {
      taRef.current = el;
      if (typeof inputRef === "function") inputRef(el);
      else if (inputRef != null) {
        (inputRef as { current: HTMLTextAreaElement | null }).current = el;
      }
    },
    [inputRef],
  );

  // Debounce the value the checker sees; the mirror always renders the
  // debounced text so its token offsets stay aligned.
  useEffect(() => {
    if (debouncedValue === value) return;
    const timer = window.setTimeout(() => setDebouncedValue(value), DEBOUNCE_MS);
    return (): void => window.clearTimeout(timer);
  }, [value, debouncedValue]);

  // Copy the textarea's computed typography onto the mirror. Guarded by a
  // serialized key so a re-render that did not change the style never loops.
  useEffect(() => {
    const ta = taRef.current;
    if (ta === null || typeof window.getComputedStyle !== "function") return;
    const cs = window.getComputedStyle(ta);
    const next: CSSProperties = {
      ...MIRROR_BASE,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      padding: cs.padding,
    };
    const key = JSON.stringify(next);
    if (key === mirrorKeyRef.current) return;
    mirrorKeyRef.current = key;
    setMirrorStyle(next);
  }, [value, className, style]);

  const syncScroll = useCallback((): void => {
    const ta = taRef.current;
    const mirror = mirrorRef.current;
    if (ta === null || mirror === null) return;
    mirror.scrollTop = ta.scrollTop;
    mirror.scrollLeft = ta.scrollLeft;
  }, []);

  const dictionary = spellCheck.dictionary;
  const ready = spellCheck.enabled && spellCheck.status === "ready" && dictionary !== null;
  const effectiveText = debouncedValue === value ? debouncedValue : null;

  const allTokens = useMemo(
    (): SpellToken[] => (effectiveText === null ? [] : tokenizeForSpell(effectiveText)),
    [effectiveText],
  );
  const misspelled = useMemo((): SpellToken[] => {
    if (!ready || dictionary === null) return [];
    return allTokens.filter((token) => isSpellMisspelled(token.word, dictionary));
  }, [ready, dictionary, allTokens]);

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLTextAreaElement>): void => {
      if (!ready || dictionary === null || effectiveText === null) return;
      const ta = taRef.current;
      let offset = ta?.selectionStart ?? 0;
      const doc = document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      if (typeof doc.caretRangeFromPoint === "function") {
        const range = doc.caretRangeFromPoint(e.clientX, e.clientY);
        if (range !== null && ta !== null && range.startContainer === ta) {
          offset = range.startOffset;
        }
      }
      const token = tokenAtOffset(offset, allTokens);
      if (token === null || !isSpellMisspelled(token.word, dictionary)) return;
      const suggestions = suggestSpellCorrections(token.word, dictionary).slice(
        0,
        SPELL_SUGGESTION_LIMIT,
      );
      // No candidates: fall through to the native context menu rather than
      // opening an empty suggestion listbox with no actions.
      if (suggestions.length === 0) return;
      e.preventDefault();
      const wrap = ta?.parentElement ?? null;
      const rect = wrap?.getBoundingClientRect();
      setPopover({
        token,
        suggestions,
        x: rect !== undefined ? e.clientX - rect.left : 0,
        y: rect !== undefined ? e.clientY - rect.top : 0,
      });
    },
    [ready, dictionary, effectiveText, allTokens],
  );

  // Escape / click-outside dismissal while the popover is open.
  useEffect(() => {
    if (popover === null) return;
    const onDocDown = (e: MouseEvent): void => {
      const wrap = taRef.current?.parentElement ?? null;
      if (wrap !== null && e.target instanceof Node && wrap.contains(e.target)) return;
      setPopover(null);
    };
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape") setPopover(null);
    };
    document.addEventListener("mousedown", onDocDown, true);
    window.addEventListener("keydown", onKey);
    return (): void => {
      document.removeEventListener("mousedown", onDocDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [popover]);

  const applySuggestion = useCallback(
    (suggestion: string): void => {
      const token = popover?.token;
      if (token === undefined) return;
      const next = value.slice(0, token.start) + suggestion + value.slice(token.end);
      onChange(next);
      setPopover(null);
    },
    [popover, value, onChange],
  );

  const statusText =
    spellCheck.status === "off"
      ? "Spell check off"
      : spellCheck.status === "loading"
        ? "Loading dictionary..."
        : spellCheck.status === "error"
          ? "Spell check unavailable - dictionary could not be loaded"
          : null;

  // An absolutely-positioned textarea (the on-canvas run editor) has its box
  // lifted onto the wrapper so the mirror aligns; the textarea then fills it.
  const absolute = style?.position === "absolute" || style?.position === "fixed";
  const wrapperStyle: CSSProperties = absolute
    ? {
        position: style?.position,
        left: style?.left,
        top: style?.top,
        width: style?.width,
        height: style?.height,
        boxSizing: "border-box",
      }
    : { position: "relative" };
  const textareaStyle: CSSProperties = {
    ...style,
    ...(absolute
      ? { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" }
      : {}),
    background: "transparent",
  };

  return (
    <div className="spell-text-wrap" style={wrapperStyle}>
      <div ref={mirrorRef} aria-hidden className="spell-text-mirror" style={mirrorStyle}>
        {buildMirror(debouncedValue, misspelled)}
      </div>
      <textarea
        ref={setTaRef}
        className={className}
        {...textareaAttrs}
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        spellCheck={false}
        style={textareaStyle}
        onChange={(e): void => onChange(e.target.value)}
        onBlur={(e): void => onCommit?.(e.relatedTarget)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onScroll={syncScroll}
        onContextMenu={handleContextMenu}
      />
      {popover !== null ? (
        <div
          className="spell-text-suggest"
          data-spell-suggest
          role="listbox"
          aria-label="Spelling suggestions"
          style={{ left: popover.x, top: popover.y }}
          onMouseDown={(e): void => e.preventDefault()}
        >
          {popover.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              data-spell-suggestion
              className="spell-text-suggestion"
              role="option"
              aria-selected={false}
              onClick={(): void => applySuggestion(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
      {statusText !== null ? (
        <div className="spell-text-status" data-spell-status>
          {statusText}
        </div>
      ) : null}
    </div>
  );
}