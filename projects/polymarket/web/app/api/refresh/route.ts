import { refreshManager } from "@/lib/live-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  // Browser visits may request a job; cross-site pages may not trigger workers.
  const origin = request.headers.get("origin");
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && new URL(origin).host !== forwardedHost) {
    return Response.json({ message: "Invalid origin" }, { status: 403, headers });
  }
  const job = refreshManager.start();
  return Response.json(job, { status: 202, headers });
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  const job = id ? refreshManager.get(id) : undefined;
  if (!job) return Response.json({ message: "Refresh expired or server restarted. Please retry." }, { status: 404, headers });
  return Response.json(job, { headers });
}
