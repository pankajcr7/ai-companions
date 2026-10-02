/** Builds a multipart/form-data body for app.inject. Files: [fieldName, filename, content]. */
export function multipart(fields: Record<string, string>, files: [string, string, Buffer | string][]) {
  const boundary = `----test${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  for (const [field, filename, content] of files) {
    parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${field}"; filename="${filename}"\r\ncontent-type: application/octet-stream\r\n\r\n`));
    parts.push(Buffer.isBuffer(content) ? content : Buffer.from(content));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
