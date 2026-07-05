/**
 * Dense linear system solver: Gaussian elimination with partial pivoting.
 *
 * Sizes here are tiny (8x8 for the homography DLT), so a straightforward
 * O(n³) elimination is the right tool — no numerical library dependency.
 */

/**
 * Solve A·x = b for x, where A is n×n given as row-major Float64Array/number[][].
 * Mutates copies, not the inputs. Returns null if the matrix is singular
 * (pivot below tolerance), which callers must treat as "degenerate input".
 */
export function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Build the augmented matrix [A | b] so row swaps carry b along.
  const m = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting: swap in the row with the largest |value| in this
    // column to keep the elimination numerically stable.
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(m[pivotRow][col]) < 1e-12) return null; // singular
    if (pivotRow !== col) [m[col], m[pivotRow]] = [m[pivotRow], m[col]];

    // Eliminate this column from all rows below the pivot.
    for (let r = col + 1; r < n; r++) {
      const factor = m[r][col] / m[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c];
    }
  }

  // Back-substitution.
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r][n];
    for (let c = r + 1; c < n; c++) sum -= m[r][c] * x[c];
    x[r] = sum / m[r][r];
  }
  return x;
}
