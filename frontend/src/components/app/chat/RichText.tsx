"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { fenceInfo } from "@/lib/rich";
import { CodeCard } from "./CodeCard";

// No rehype-raw: HTML in model output is never rendered.
const components: Components = {
  pre({ node }) {
    const code = node?.children[0];
    if (!code || code.type !== "element") return null;
    const cls = code.properties?.className;
    const className = Array.isArray(cls) ? cls.join(" ") : typeof cls === "string" ? cls : undefined;
    const text = code.children.map((c) => (c.type === "text" ? c.value : "")).join("").replace(/\n$/, "");
    const meta = (code.data as { meta?: string } | undefined)?.meta;
    const { language, title } = fenceInfo(className, meta);
    return <CodeCard code={text} language={language} title={title} />;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto">
        <table>{children}</table>
      </div>
    );
  },
};

export function RichText({ text }: { text: string }) {
  return (
    <div className="rich min-w-0 text-sm">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
