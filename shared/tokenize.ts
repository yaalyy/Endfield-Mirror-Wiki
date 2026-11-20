const segmenter = new Intl.Segmenter("zh-Hans", { granularity: "word" });
export function tokenize(input: string): string[] {
  const text = input.normalize("NFKC").toLowerCase();
  const tokens = new Set<string>();
  for (const part of segmenter.segment(text))
    if (part.isWordLike) tokens.add(part.segment);
  for (const run of text.match(/[\p{Script=Han}]+/gu) || []) {
    const chars = [...run];
    for (let i = 0; i < chars.length; i++) {
      tokens.add(chars[i]);
      for (let n = 2; n <= 3 && i + n <= chars.length; n++)
        tokens.add(chars.slice(i, i + n).join(""));
    }
  }
  return [...tokens];
}
