"use client";

import { useEffect, useRef } from "react";
import { basicSetup, EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";

function languageFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext && ["js", "jsx", "mjs", "cjs", "ts", "tsx"].includes(ext)) return javascript({ typescript: ext.startsWith("t"), jsx: ext.endsWith("x") });
  if (ext === "json") return json();
  if (ext === "html" || ext === "htm") return html();
  if (ext === "css") return css();
  if (ext === "md" || ext === "markdown") return markdown();
  if (ext === "py") return python();
  return [];
}

type Props = { value: string; path: string; readOnly: boolean; dark: boolean; onChange: (v: string) => void; onSave: () => void };

/** CodeMirror 6. Remounts per path so each file gets its own undo history. */
export function CodeEditor({ value, path, readOnly, dark, onChange, onSave }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onSave });
  const theme = useRef(new Compartment());
  const initial = useRef(value);
  const initialDark = useRef(dark);

  useEffect(() => {
    callbacks.current = { onChange, onSave };
  }, [onChange, onSave]);

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          basicSetup,
          languageFor(path),
          theme.current.of(initialDark.current ? oneDark : []),
          EditorState.readOnly.of(readOnly),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) callbacks.current.onChange(u.state.doc.toString());
          }),
          EditorView.contentAttributes.of({ "aria-label": `Editing ${path}` }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
  }, [path, readOnly]);

  useEffect(() => {
    view.current?.dispatch({ effects: theme.current.reconfigure(dark ? oneDark : []) });
  }, [dark]);

  // Replace the document when the parent loads a different version (reload, restore).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className="h-full min-h-[300px] overflow-auto text-sm [&_.cm-editor]:h-full" />;
}
