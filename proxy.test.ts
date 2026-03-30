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
});
