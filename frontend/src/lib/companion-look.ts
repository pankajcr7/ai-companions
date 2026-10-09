/** A stable secondary color gives every companion its own identity without changing saved customization. */
const ACCENTS = ["#9bc981", "#83bce8", "#e6ab82", "#c09bd5", "#e4c16d", "#82c9bf", "#df99ac", "#99a9dc"];

export function companionSignature(identity: string) {
  let hash = 2166136261;
  for (const letter of identity) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619) >>> 0;
  return { accent: ACCENTS[hash % ACCENTS.length], mark: (hash >>> 3) % 4 };
}

export function shadeColor(hex: string, target: string, amount: number) {
  const rgb = (value: string) => /^#[0-9a-f]{6}$/i.test(value) ? [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) : [161, 161, 170];
  const base = rgb(hex);
  const end = rgb(target);
  return `#${base.map((v, i) => Math.round(v + (end[i] - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}
