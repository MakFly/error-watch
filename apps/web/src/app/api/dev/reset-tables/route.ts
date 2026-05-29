import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { buildSessionCookieHeader } from "@/lib/auth-cookies";
import { getMonitoringApiUrl } from "@/lib/config";
const API_URL = getMonitoringApiUrl();

export async function POST() {
  // Block in production
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  try {
    const cookieStore = await cookies();
    const sessionCookieHeader = buildSessionCookieHeader(cookieStore.getAll());

    const res = await fetch(`${API_URL}/api/v1/dev/reset-tables`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sessionCookieHeader ? { Cookie: sessionCookieHeader } : {}),
      },
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
