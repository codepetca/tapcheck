import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";
import { isWorkosConfigured } from "@/lib/workos-config";
import { sanitizeReturnPath } from "@/lib/workos-auth";

export async function GET(request: NextRequest) {
  const returnTo = sanitizeReturnPath(request.nextUrl.searchParams.get("returnTo"));

  if (!isWorkosConfigured()) {
    return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(returnTo)}`, request.url));
  }

  const signInUrl = await getSignInUrl({ returnTo });
  return NextResponse.redirect(signInUrl);
}
