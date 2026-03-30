"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { AUTH_ROUTE_PATHS } from "@/lib/auth-routes";

export function ClerkHeaderControls() {
  const pathname = usePathname();

  if (pathname && AUTH_ROUTE_PATHS.has(pathname)) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <Show when="signed-out">
        <SignInButton>
          <button className="inline-flex h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-400 hover:text-slate-950">
            Sign in
          </button>
        </SignInButton>
        <SignUpButton>
          <button className="inline-flex h-10 items-center justify-center rounded-full bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800">
            Sign up
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </div>
  );
}
