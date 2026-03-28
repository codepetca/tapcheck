import "server-only";

import { withAuth } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { isWorkosConfigured } from "@/lib/workos-config";

export function sanitizeReturnPath(returnPath?: string | null) {
  if (!returnPath || !returnPath.startsWith("/") || returnPath.startsWith("//")) {
    return "/";
  }

  return returnPath;
}

export async function requireAuthenticatedPage(returnPath: string) {
  const safeReturnPath = sanitizeReturnPath(returnPath);
  const { user } = await withAuth();

  if (!user) {
    redirect(`/login?returnTo=${encodeURIComponent(safeReturnPath)}`);
  }

  return user;
}

export async function redirectAuthenticatedUser(returnPath?: string | null) {
  const safeReturnPath = sanitizeReturnPath(returnPath);
  const { user } = await withAuth();

  if (!user) {
    return null;
  }

  redirect(safeReturnPath);
}

export function getAuthEntryPath(entrypoint: "sign-in" | "sign-up", returnPath?: string | null) {
  const safeReturnPath = sanitizeReturnPath(returnPath);
  return `/auth/${entrypoint}?returnTo=${encodeURIComponent(safeReturnPath)}`;
}

export { isWorkosConfigured };
