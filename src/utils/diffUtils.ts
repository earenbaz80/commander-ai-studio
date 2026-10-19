export type DiffType = 'added' | 'removed' | 'unchanged';

export interface DiffLine {
  type: DiffType;
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface DiffStats {
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
}

/**
 * Computes a line-by-line diff between two strings using Longest Common Subsequence (LCS).
 */
export function computeLineDiff(oldText: string, newText: string): { lines: DiffLine[]; stats: DiffStats } {
  const oldLines = oldText ? oldText.split(/\r?\n/) : [];
  const newLines = newText ? newText.split(/\r?\n/) : [];

  const n = oldLines.length;
  const m = newLines.length;

  // LCS Matrix
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const diff: DiffLine[] = [];
  let i = n;
  let j = m;

  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.unshift({
        type: 'unchanged',
        oldLineNumber: i,
        newLineNumber: j,
        content: oldLines[i - 1],
      });
      unchangedCount++;
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({
        type: 'added',
        newLineNumber: j,
        content: newLines[j - 1],
      });
      addedCount++;
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      diff.unshift({
        type: 'removed',
        oldLineNumber: i,
        content: oldLines[i - 1],
      });
      removedCount++;
      i--;
    }
  }

  return {
    lines: diff,
    stats: {
      addedCount,
      removedCount,
      unchangedCount,
    },
  };
}
