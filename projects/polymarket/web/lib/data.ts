import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");

function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, rel), "utf8")) as T;
}

export type GraphNode = {
  id: string;
  question: string;
  event_slug: string;
  market_slug?: string | null;
  event_title: string;
  group: string;
  tags: string[];
  volume: number;
  median_price: number;
  current_price?: number | null;
  n_days: number;
};

export type GraphEdge = {
  a: string;
  b: string;
  r: number;
  n: number;
  q: number;
  robust: boolean;
  relation: "same_event" | "shared_tag" | "non_obvious";
};

export type Graph = {
  generated: string;
  fetch_started_at?: string;
  params: Record<string, unknown>;
  n_screened: number;
  n_long_shots_excluded: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export function getGraph(): Graph {
  return readJson<Graph>("graph.json");
}
