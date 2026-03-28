import { PageShell } from "@/components/page-shell";
import { AuthSetupNotice } from "@/components/auth-setup-notice";
import { buttonVariants } from "@/components/ui/button";
import {
  getAuthEntryPath,
  isWorkosConfigured,
  redirectAuthenticatedUser,
  sanitizeReturnPath,
} from "@/lib/workos-auth";

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isWorkosConfigured()) {
    return (
      <PageShell title="Tapcheck" subtitle="Create account">
        <AuthSetupNotice />
      </PageShell>
    );
  }

  const resolvedSearchParams = await searchParams;
  const returnToParam = resolvedSearchParams.returnTo;
  const returnTo = sanitizeReturnPath(
    Array.isArray(returnToParam) ? returnToParam[0] : returnToParam,
  );

  await redirectAuthenticatedUser(returnTo);
  const signInUrl = getAuthEntryPath("sign-in", returnTo);
  const signUpUrl = getAuthEntryPath("sign-up", returnTo);

  return (
    <PageShell title="Tapcheck" subtitle="Create your Tapcheck account">
      <section className="rounded-[28px] border border-white/70 bg-white/90 px-6 py-8 shadow-sm">
        <h2 className="font-heading text-2xl font-semibold tracking-tight text-slate-950">
          Create roster access
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Create an individual account to manage your own rosters, sessions, and attendance exports.
        </p>
        <div className="mt-6 space-y-3">
          <a href={signUpUrl} className={buttonVariants({ className: "w-full" })}>
            Create account
          </a>
          <a
            href={signInUrl}
            className={buttonVariants({ variant: "outline", className: "w-full" })}
          >
            I already have an account
          </a>
        </div>
      </section>
    </PageShell>
  );
}
