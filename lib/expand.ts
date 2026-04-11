const STOPWORDS = new Set([
  "a","an","the","and","or","but","with","of","for","to","in","on","at","by",
  "i","me","my","want","need","images","image","photos","photo","pictures","picture",
  "like","that","this","some","it","its","very","really","mood","moodboard","board",
  "vibe","feel","feeling","show","find","get","looking","search",
]);

/**
 * v1 query expansion: rule-based. Splits the prompt into focused sub-queries
 * so we pull broader visual variety than a single search would give.
 * Free, deterministic, no LLM call.
 */
export function expandQuery(prompt: string): string[] {
  const cleaned = prompt.toLowerCase().replace(/[^\p{L}\p{N}\s,-]/gu, " ");
  const phrases = cleaned.split(/[,;]| and | with | plus /).map(s => s.trim()).filter(Boolean);

  const queries = new Set<string>();
  queries.add(prompt.trim());

  for (const phrase of phrases) {
    const words = phrase.split(/\s+/).filter(w => w && !STOPWORDS.has(w));
    if (words.length === 0) continue;
    queries.add(words.join(" "));
    if (words.length >= 3) queries.add(words.slice(0, 3).join(" "));
  }

  return Array.from(queries).slice(0, 5);
}
