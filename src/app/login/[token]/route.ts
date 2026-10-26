import { NextResponse, type NextRequest } from "next/server";
import { signInWithToken } from "@/server/auth";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = await signInWithToken(token);
  return NextResponse.redirect(new URL(ok ? "/" : "/?login=expired", request.url));
}
