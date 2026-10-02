/** Parses a server-sent-events byte stream into { event, data } records. */
export async function* readSse(body: AsyncIterable<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let sep: RegExpExecArray | null;
    while ((sep = /\r?\n\r?\n/.exec(buf))) {
      const block = buf.slice(0, sep.index);
      buf = buf.slice(sep.index + sep[0].length);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue;
        const i = line.indexOf(":");
        const field = i === -1 ? line : line.slice(0, i);
        const value = i === -1 ? "" : line.slice(i + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length) yield { event, data: data.join("\n") };
    }
  }
}
