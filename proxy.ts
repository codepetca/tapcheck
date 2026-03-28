import { authkitProxy } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isWorkosConfigured } from "@/lib/workos-config";

const proxyHandler = authkitProxy();

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!isWorkosConfigured()) {
    return NextResponse.next();
  }

  return proxyHandler(request, event);
}

export const config = {
  matcher: ["/", "/login", "/signup", "/unauthorized", "/rosters/:path*", "/auth/callback"],
};
