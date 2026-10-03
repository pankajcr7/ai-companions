"use client";

import { useMemo, type ReactNode } from "react";
import type { Language } from "@codemirror/language";
import { cssLanguage } from "@codemirror/lang-css";
import { htmlLanguage } from "@codemirror/lang-html";
import { javascriptLanguage, jsxLanguage, tsxLanguage, typescriptLanguage } from "@codemirror/lang-javascript";
import { jsonLanguage } from "@codemirror/lang-json";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { pythonLanguage } from "@codemirror/lang-python";
import { classHighlighter, highlightCode } from "@lezer/highlight";
import { CopyButton } from "./CopyButton";

const LANGS: Record<string, Language> = {
  js: javascriptLanguage,
  mjs: javascriptLanguage,
  cjs: javascriptLanguage,
  jsx: jsxLanguage,
  ts: typescriptLanguage,
  tsx: tsxLanguage,
  json: jsonLanguage,
  html: htmlLanguage,
  css: cssLanguage,
  md: markdownLanguage,
  py: pythonLanguage,
};

function highlight(code: string, language: string): ReactNode[] {
  const lang = LANGS[language];
  if (!lang) return [code];
  const out: ReactNode[] = [];
  highlightCode(
    code,
    lang.parser.parse(code),
    classHighlighter,
    (text, classes) => out.push(classes ? <span key={out.length} className={classes}>{text}</span> : text),
    () => out.push("\n"),
  );
  return out;
}

export function CodeCard({ code, language, title }: { code: string; language: string; title: string | null }) {
  const nodes = useMemo(() => highlight(code, language), [code, language]);
  const name = title ? `Code: ${title}` : `Code (${language || "text"})`;
  return (
    <figure aria-label={name} className="code-card my-2 min-w-0 overflow-hidden rounded-[10px] border border-[#262a31] bg-[#0f1115] text-[#e3e6ea]">
      <figcaption className="flex items-center justify-between gap-2 border-b border-[#262a31] px-3 py-1.5 text-[11px] text-[#9aa1aa]">
        <span className="truncate font-mono">{title ?? (language || "code")}</span>
        <CopyButton text={code} className="text-[#e3e6ea]" />
      </figcaption>
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed">
        <code>{nodes}</code>
      </pre>
    </figure>
  );
}
