/** Categorical slots from the reference palette, in the validated fixed
 * order. Colors are CSS variables so light/dark resolve in the stylesheet;
 * recharts accepts `var(--s1)` as a stroke. */
export const SERIES = [
  "var(--s1)",
  "var(--s2)",
  "var(--s3)",
  "var(--s4)",
  "var(--s5)",
  "var(--s6)",
  "var(--s7)",
  "var(--s8)",
];

export const DIM = "var(--dim)";

/** Families used to group statistics in tables and charts. */
export type Family = "geometric" | "baseline-level" | "baseline-change";

export function familyOf(statistic: string): Family {
  if (statistic.startsWith("jacobi") || statistic.startsWith("empirical_residual")) return "geometric";
  if (statistic.startsWith("trace") || statistic.startsWith("top_eigenvalue")) return "baseline-level";
  return "baseline-change";
}

export const FAMILY_LABEL: Record<Family, string> = {
  geometric: "Geometric (Jacobi)",
  "baseline-level": "Baseline: level",
  "baseline-change": "Baseline: change",
};

export const STATISTIC_BLURB: Record<string, string> = {
  trace: "Trace of the window covariance: total variance.",
  top_eigenvalue: "Largest eigenvalue: variance along the dominant common direction.",
  frobenius_step: "Frobenius norm of the change in covariance since the previous window.",
  correlation_break: "Frobenius norm of the change in the correlation matrix; blind to pure scale change.",
  log_trace_step: "Absolute change in log trace; scale-free, blind to correlation structure.",
  empirical_residual: "Norm of the geodesic residual: how far the step departs from the geodesic continuation of the previous step (no curvature bound).",
  jacobi_single_step: "|residual − Jacobi bound|. Unsigned: also fires when the residual falls far below the bound.",
  "jacobi_single_step[signed]": "residual − Jacobi bound. Positive means deviation beyond what curvature allows: the actual geometric claim.",
  "jacobi_growth_rate[h=w/2|signed]": "Signed excess of a multi-step geodesic extrapolation over the curvature-predicted growth.",
};

export function blurbFor(label: string): string {
  const base = label.replace(/\[.*\]$/, "");
  return STATISTIC_BLURB[label] ?? STATISTIC_BLURB[base] ?? "";
}
