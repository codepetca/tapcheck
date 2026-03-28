import { Card } from "@/components/ui/card";

export function AuthSetupNotice() {
  return (
    <Card className="border border-white/70 bg-white/90 px-6 py-8 text-left shadow-sm">
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-400">Setup required</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
        Add your WorkOS auth settings.
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Configure <code className="rounded bg-slate-100 px-1.5 py-0.5">WORKOS_CLIENT_ID</code>,{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5">WORKOS_API_KEY</code>,{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5">WORKOS_COOKIE_PASSWORD</code>, and{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5">NEXT_PUBLIC_WORKOS_REDIRECT_URI</code>{" "}
        in your local environment, then restart the app.
      </p>
    </Card>
  );
}
