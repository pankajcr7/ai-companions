/**
 * Finding JSON in model replies. Replies wrap JSON in ```json fences, but the JSON itself can contain
 * backticks and braces inside strings (a README with code examples), so the end of a block is found by
 * reading the JSON, never by looking for the next ``` fence.
 */

/** Index of the brace that closes the object opening at `open`, reading strings properly; -1 if it never closes. */
export function closingBrace(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

export type JsonBlock = { value: unknown; start: number; end: number };

/** Widens [start, end) to include a surrounding ``` fence, so removing the span leaves only prose. */
function withFence(text: string, start: number, end: number) {
  const open = /```[a-zA-Z]*[ \t]*\r?\n?[ \t]*$/.exec(text.slice(0, start));
  const close = /^\s*```/.exec(text.slice(end));
  return { start: open ? start - open[0].length : start, end: close ? end + close[0].length : end };
}

/**
 * The JSON object in `text` that ends last among those that parse. With `key`, only objects whose
 * first key is that key count (e.g. "edits"). Objects nested inside another candidate are ignored,
 * because the outer one ends later.
 */
export function findJsonBlock(text: string, key?: string): JsonBlock | null {
  const starts: number[] = [];
  if (key) {
    for (const m of text.matchAll(new RegExp(`\\{\\s*"${key}"\\s*:`, "g"))) starts.push(m.index!);
  } else {
    // Objects that start a line, the reply, or a fence are tried first.
    for (const m of text.matchAll(/(^|\n|```[a-zA-Z]*\s*)[ \t]*\{/g)) starts.push(m.index! + m[0].length - 1);
  }
  const best = bestOf(text, starts);
  if (best || key) return best;
  // Last resort: JSON in the middle of a sentence ("Here: {...} done").
  return bestOf(text, [...text.matchAll(/\{/g)].map((m) => m.index!));
}

function bestOf(text: string, starts: number[]): JsonBlock | null {
  let best: JsonBlock | null = null;
  for (const start of starts) {
    if (best && start < best.end) continue;
    const close = closingBrace(text, start);
    if (close < 0) continue;
    try {
      const value = JSON.parse(text.slice(start, close + 1));
      best = { value, ...withFence(text, start, close + 1) };
    } catch {
      // not JSON after all; keep looking
    }
  }
  return best;
}

/** True when a reply starts a JSON object with `key` that never closes (the reply was cut off). */
export function hasUnclosedBlock(text: string, key: string): boolean {
  const matches = [...text.matchAll(new RegExp(`\\{\\s*"${key}"\\s*:`, "g"))];
  const last = matches.at(-1);
  return !!last && closingBrace(text, last.index!) < 0;
}
