import { NextResponse } from "next/server";
export async function GET() {
  try {
    const response = await fetch(`${process.env.GDELT_API_URL || "http://127.0.0.1:8000"}/events?limit=500`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error("upstream");
    const events = await response.json();
    if (!Array.isArray(events)) throw new Error("shape");
    return NextResponse.json(events);
  } catch { return NextResponse.json({error: "The event service is unavailable. Start the FastAPI service and load a bounded dataset, then try again."}, {status:503}); }
}
