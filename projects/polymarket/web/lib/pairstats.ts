/** Client-side pair statistics on daily price series (probabilities in
 * (0,1)). All are descriptive: they summarize the sampled daily history
 * and carry no significance testing beyond what the screen already did. */

export type PriceTable = { dates: string[]; series: Record<string, (number | null)[]> };

const EPS = 1e-4;

export function logitChanges(p: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = [null];
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1];
    const b = p[i];
    if (a == null || b == null) {
      out.push(null);
      continue;
    }
    const ca = Math.min(1 - EPS, Math.max(EPS, a));
    const cb = Math.min(1 - EPS, Math.max(EPS, b));
    out.push(Math.log(cb / (1 - cb)) - Math.log(ca / (1 - ca)));
  }
  return out;
}

function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 5) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 0 || syy <= 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function ranks(v: number[]): number[] {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

/** Align two change series on days where both are observed, with an
 * optional lag applied to b (positive lag: b shifted later, i.e. corr(a_t, b_{t+lag})). */
function aligned(a: (number | null)[], b: (number | null)[], lag = 0): [number[], number[]] {
  const x: number[] = [];
  const y: number[] = [];
  for (let t = 0; t < a.length; t++) {
    const u = t + lag;
    if (u < 0 || u >= b.length) continue;
    const va = a[t];
    const vb = b[u];
    if (va == null || vb == null) continue;
    x.push(va);
    y.push(vb);
  }
  return [x, y];
}

export function spearman(a: (number | null)[], b: (number | null)[]): { r: number | null; n: number } {
  const [x, y] = aligned(a, b);
  return { r: x.length >= 5 ? pearson(ranks(x), ranks(y)) : null, n: x.length };
}

export function crossCorr(a: (number | null)[], b: (number | null)[], lag: number): number | null {
  const [x, y] = aligned(a, b, lag);
  return x.length >= 20 ? pearson(x, y) : null;
}

/** Rolling Pearson correlation of changes over a trailing window; null
 * where fewer than half the window's days are jointly observed. */
export function rollingCorr(a: (number | null)[], b: (number | null)[], window = 60): (number | null)[] {
  const out: (number | null)[] = [];
  for (let t = 0; t < a.length; t++) {
    if (t < window - 1) {
      out.push(null);
      continue;
    }
    const x: number[] = [];
    const y: number[] = [];
    for (let u = t - window + 1; u <= t; u++) {
      const va = a[u];
      const vb = b[u];
      if (va != null && vb != null) {
        x.push(va);
        y.push(vb);
      }
    }
    out.push(x.length >= window / 2 ? pearson(x, y) : null);
  }
  return out;
}

/** Among days when both markets moved, the share that moved the same way. */
export function coMoveShare(a: (number | null)[], b: (number | null)[]): { share: number | null; n: number } {
  let same = 0;
  let n = 0;
  for (let t = 0; t < a.length; t++) {
    const va = a[t];
    const vb = b[t];
    if (va == null || vb == null || va === 0 || vb === 0) continue;
    n++;
    if (Math.sign(va) === Math.sign(vb)) same++;
  }
  return { share: n ? same / n : null, n };
}

export const logit = (p: number) => {
  const c = Math.min(1 - EPS, Math.max(EPS, p));
  return Math.log(c / (1 - c));
};
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** OLS beta of b's daily log-odds change on a's, with the correlation and
 * the residual standard deviation (the one-day uncertainty of the
 * covariance-implied move). Days where neither market moved are excluded
 * so stale quotes do not shrink the estimate. */
export function betaOn(
  a: (number | null)[],
  b: (number | null)[],
): { beta: number; rho: number; residSd: number; n: number } | null {
  const x: number[] = [];
  const y: number[] = [];
  for (let t = 0; t < a.length; t++) {
    const va = a[t];
    const vb = b[t];
    if (va == null || vb == null || (va === 0 && vb === 0)) continue;
    x.push(va);
    y.push(vb);
  }
  const n = x.length;
  if (n < 20) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx <= 0 || syy <= 0) return null;
  const beta = sxy / sxx;
  const rho = sxy / Math.sqrt(sxx * syy);
  const residVar = Math.max(0, (syy - beta * sxy) / (n - 2));
  return { beta, rho, residSd: Math.sqrt(residVar), n };
}

/** Empirical check: on the days when |dA| was in its top `share` fraction,
 * how did B move the same day? Returns the median of B's move signed by
 * A's direction (in log-odds), the share of those days B went the same
 * way, and the count. */
export function bigDayResponse(
  a: (number | null)[],
  b: (number | null)[],
  share = 0.1,
): { medianSigned: number; sameDir: number; n: number } | null {
  const pairs: [number, number][] = [];
  for (let t = 0; t < a.length; t++) {
    const va = a[t];
    const vb = b[t];
    if (va == null || vb == null || va === 0) continue;
    pairs.push([va, vb]);
  }
  if (pairs.length < 20) return null;
  const mags = pairs.map(([va]) => Math.abs(va)).sort((p, q) => q - p);
  const cut = mags[Math.max(0, Math.floor(mags.length * share) - 1)];
  const big = pairs.filter(([va]) => Math.abs(va) >= cut);
  if (big.length < 5) return null;
  const signed = big.map(([va, vb]) => vb * Math.sign(va)).sort((p, q) => p - q);
  const mid = signed.length >> 1;
  const median = signed.length % 2 ? signed[mid] : (signed[mid - 1] + signed[mid]) / 2;
  const sameDir = big.filter(([va, vb]) => vb !== 0 && Math.sign(vb) === Math.sign(va)).length / big.length;
  return { medianSigned: median, sameDir, n: big.length };
}
