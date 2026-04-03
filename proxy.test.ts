import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGN_IN_URL, SIGN_UP_URL } from "./lib/auth-routes";

const clerkMiddlewareMock = vi.fn();
const createRouteMatcherMock = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: (...args: unknown[]) => clerkMiddlewareMock(...args),
  createRouteMatcher: (...args: unknown[]) => createRouteMatcherMock(...args),
}));

describe("proxy", () => {
  beforeEach(() => {
    vi.resetModules();
    clerkMiddlewareMock.mockReset();
    createRouteMatcherMock.mockReset();
  });

  it("configures Clerk middleware with the app auth routes", async () => {
    clerkMiddlewareMock.mockReturnValue(() => null);
    createRouteMatcherMock.mockReturnValue(() => false);

    await import("./proxy");

    expect(createRouteMatcherMock).toHaveBeenCalledWith(["/", "/rosters(.*)"]);
    expect(clerkMiddlewareMock).toHaveBeenCalledWith(expect.any(Function), {
      signInUrl: SIGN_IN_URL,
      signUpUrl: SIGN_UP_URL,
    });
  });

  it("protects dashboard and roster routes while leaving auth and editor token routes public", async () => {
    clerkMiddlewareMock.mockImplementation((handler) => handler);
    createRouteMatcherMock.mockImplementation(() => {
      return (req: { nextUrl?: { pathname?: string } }) => {
        const pathname = req.nextUrl?.pathname ?? "";
        return pathname === "/" || pathname.startsWith("/rosters");
      };
    });

    await import("./proxy");
    const handler = clerkMiddlewareMock.mock.calls[0]?.[0] as (
      auth: { protect: ReturnType<typeof vi.fn> },
      req: { nextUrl: { pathname: string } },
    ) => Promise<void>;
    const protect = vi.fn().mockResolvedValue(undefined);
    const auth = { protect };

    await handler(auth, { nextUrl: { pathname: "/" } });
    await handler(auth, { nextUrl: { pathname: "/rosters/import" } });
    await handler(auth, { nextUrl: { pathname: SIGN_IN_URL } });
    await handler(auth, { nextUrl: { pathname: "/s/edit/editor-token-1" } });

    expect(protect).toHaveBeenCalledTimes(2);
  });
});
