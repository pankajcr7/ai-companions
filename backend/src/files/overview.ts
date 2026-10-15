type Cover = { path: string; revision: number };
export function projectCover(files: Cover[]) {
  const visible = files.filter((f) => !f.path.startsWith(".company/"));
  const file = visible.find((f) => /(^|\/)index\.html?$/i.test(f.path))
    ?? visible.find((f) => /\.html?$/i.test(f.path))
    ?? visible.find((f) => /\.(png|jpe?g|webp|avif)$/i.test(f.path))
    ?? visible.find((f) => /\.(md|txt|csv)$/i.test(f.path))
    ?? visible[0];
  if (!file) return null;
  const kind = /\.html?$/i.test(file.path) ? "website" : /\.(png|jpe?g|gif|webp|avif)$/i.test(file.path) ? "image" : /\.(md|txt|csv|pdf|docx?|xlsx?|pptx?)$/i.test(file.path) ? "document" : /\.(tsx?|jsx?|css|json|py|sql|ya?ml)$/i.test(file.path) ? "code" : "file";
  return { ...file, kind };
}
