import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Graph } from "./data";
import type { PriceTable } from "./pairstats";

export type Snapshot = { graph: Graph; prices: PriceTable };
export type RefreshJob = {
  id: string;
  status: "running" | "ready" | "error";
  startedAt: string;
  completedAt?: string;
  message: string;
  snapshot?: Snapshot;
};

// One persistent Node process owns one worker. Concurrent visits join its job.
// Keep finished results briefly so polling clients receive their exact pair of files.
export function createRefreshManager(run: (progress: (message: string) => void) => Promise<Snapshot>) {
  const jobs = new Map<string, RefreshJob>();
  let active: RefreshJob | undefined;
  return {
    get(id: string) { return jobs.get(id); },
    start() {
      if (active) return active;
      const job: RefreshJob = {
        id: randomUUID(), status: "running", startedAt: new Date().toISOString(),
        message: "Fetching current markets and daily price histories from Polymarket…",
      };
      jobs.set(job.id, job);
      active = job;
      void Promise.resolve().then(() => run((message) => { job.message = message; }))
        .then((snapshot) => {
          job.snapshot = snapshot;
          job.status = "ready";
          job.message = "Fresh market data and correlations are ready.";
        }).catch((error) => {
          console.error("Polymarket refresh failed:", error);
          job.status = "error";
          job.message = "Could not refresh Polymarket data. The previous snapshot has been kept. Please retry.";
        }).finally(() => {
          job.completedAt = new Date().toISOString();
          active = undefined;
          while (jobs.size > 10) jobs.delete(jobs.keys().next().value!);
        });
      return job;
    },
  };
}

export function validateSnapshot(graph: Graph, prices: PriceTable): Snapshot {
  if (!graph.nodes?.length || !Array.isArray(graph.edges) || !prices.dates?.length || !graph.generated) {
    throw new Error("Empty or invalid snapshot");
  }
  const ids = new Set(graph.nodes.map((node) => node.id));
  for (const node of graph.nodes) {
    const series = prices.series?.[node.id];
    if (!series || series.length !== prices.dates.length ||
        !series.some((v) => v !== null) ||
        series.some((v) => v !== null && (!Number.isFinite(v) || v < 0 || v > 1))) {
      throw new Error("Graph and price histories do not match");
    }
  }
  if (graph.edges.some((edge) => !ids.has(edge.a) || !ids.has(edge.b) || !Number.isFinite(edge.r))) {
    throw new Error("Invalid graph edges");
  }
  return { graph, prices };
}

async function runPipeline(progress: (message: string) => void): Promise<Snapshot> {
  const root = process.env.POLYMARKET_PROJECT_ROOT ?? path.resolve(process.cwd(), "..");
  const localPython = path.join(root, ".venv/bin/python");
  const python = process.env.POLYMARKET_PYTHON ?? (existsSync(localPython) ? localPython : "python3");
  const work = await mkdtemp(path.join(tmpdir(), "polymarket-refresh-"));
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(python, [path.join(root, "scripts/find_correlated_markets.py"),
        "--refresh", "--output-dir", work], {
        cwd: root,
        env: { ...process.env, POLYMARKET_CACHE_DIR: path.join(work, "cache"),
          PYTHONUNBUFFERED: "1", OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 30 * 60 * 1000);
      child.stdout.on("data", (chunk) => {
        const output = String(chunk);
        const match = output.match(/prices (\d+)\/(\d+)/);
        if (match) progress(`Fetching price histories: ${match[1]} of ${match[2]} markets…`);
        if (output.includes("price matrix")) progress("Recomputing correlations and checking robustness…");
      });
      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (code === 0 && !timedOut) resolve();
        else reject(new Error(timedOut ? "Refresh timed out" : `Pipeline exited ${code}: ${stderr}`));
      });
    });
    const [graph, prices] = await Promise.all([
      readFile(path.join(work, "market_graph.json"), "utf8"),
      readFile(path.join(work, "market_graph_prices.json"), "utf8"),
    ]);
    return validateSnapshot(JSON.parse(graph), JSON.parse(prices));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const globals = globalThis as typeof globalThis & { marketRefresh?: ReturnType<typeof createRefreshManager> };
export const refreshManager = globals.marketRefresh ??= createRefreshManager(runPipeline);
