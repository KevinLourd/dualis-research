"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { saveText, type TextField } from "./thesis-actions";

const SAVE_AFTER_MS = 800;

/**
 * Prefilled text Thierry can rewrite in place. It reads as plain text; on a pointer device a hover tint says it
 * is editable. A click turns the SAME box into a textarea of the same size and typography, so nothing moves.
 * Saves on its own: shortly after each pause in typing, and when focus leaves. An empty box is never saved.
 */
export function EditableText({
  symbol,
  field,
  value,
  className = "",
  label,
}: {
  symbol: string;
  field: TextField;
  value: string;
  className?: string;
  /** Accessible name, e.g. "Narrative". */
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const minHeight = useRef(0);

  // A refreshed page brings the stored text; never overwrite what is being typed.
  useEffect(() => {
    if (!editing) {
      setText(value);
      saved.current = value;
    }
  }, [value, editing]);

  const fit = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(el.scrollHeight, minHeight.current)}px`;
  };

  useLayoutEffect(() => {
    if (!editing || !area.current) return;
    fit();
    const el = area.current;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const save = async (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    const trimmed = next.trim();
    if (!trimmed || trimmed === saved.current.trim()) return;
    try {
      await saveText(symbol, field, trimmed);
      saved.current = trimmed;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const open = () => {
    minHeight.current = box.current?.offsetHeight ?? 0;
    setEditing(true);
  };

  const shared = `-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1 whitespace-pre-wrap break-words ${className}`;

  return (
    <>
      {editing ? (
        <textarea
          ref={area}
          aria-label={label}
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value);
            fit();
            if (timer.current) clearTimeout(timer.current);
            const v = e.target.value;
            timer.current = setTimeout(() => void save(v), SAVE_AFTER_MS);
          }}
          onBlur={() => {
            void save(text);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          className={`${shared} resize-none overflow-hidden bg-kumo-base ring-1 ring-kumo-line outline-none focus:ring-kumo-brand`}
        />
      ) : (
        <div
          ref={box}
          role="button"
          tabIndex={0}
          aria-label={`${label}: ${text}. Click to edit.`}
          title="Click to edit"
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              open();
            }
          }}
          className={`${shared} cursor-text ring-1 ring-transparent transition-colors duration-150 focus-visible:ring-kumo-brand focus-visible:outline-none [@media(hover:hover)]:hover:bg-kumo-tint`}
        >
          {text}
        </div>
      )}
      {error && <p className="mt-1 text-sm text-kumo-danger">Not saved: {error}</p>}
    </>
  );
}
