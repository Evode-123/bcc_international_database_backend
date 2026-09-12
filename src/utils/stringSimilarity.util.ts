/**
 * Minimal Levenshtein-distance-based similarity, used only to SUGGEST
 * likely matches for typos in imported Excel location/enum values --
 * this is never used to auto-resolve a match on its own. Only exact
 * (case-insensitive, trimmed) matches are ever applied automatically
 * by discipleImport.controller.ts; this utility exists purely to power
 * the "Did you mean...?" hints shown to the person reviewing the
 * pending import list, and to pre-select the closest cascading dropdown
 * option so they usually just need to click "confirm" rather than
 * search from scratch.
 */

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = new Array(n + 1);
  let currRow = new Array(n + 1);
  for (let j = 0; j <= n; j++) prevRow[j] = j;

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        currRow[j - 1] + 1, // insertion
        prevRow[j] + 1, // deletion
        prevRow[j - 1] + cost // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[n];
}

/** 0 (no resemblance) .. 1 (identical), case-insensitive, trimmed. */
export function similarity(a: string, b: string): number {
  const x = (a || '').trim().toLowerCase();
  const y = (b || '').trim().toLowerCase();
  if (x === y) return 1;
  const maxLen = Math.max(x.length, y.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(x, y) / maxLen;
}

export interface MatchCandidate<T> {
  item: T;
  score: number;
}

/**
 * Returns the top N candidates from `items` ranked by name-similarity to
 * `query`, above `minScore`. Used to power "Did you mean one of these?"
 * suggestions in the Excel import review UI -- e.g. someone typed
 * "Kigal" for a center and this suggests "Kigali" with a high score.
 */
export function findBestMatches<T>(
  query: string,
  items: T[],
  getName: (item: T) => string,
  { limit = 3, minScore = 0.45 }: { limit?: number; minScore?: number } = {}
): MatchCandidate<T>[] {
  if (!query?.trim()) return [];
  return items
    .map((item) => ({ item, score: similarity(query, getName(item)) }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}