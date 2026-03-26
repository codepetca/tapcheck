import Link from "next/link";

type PageShellProps = {
  title: string;
  subtitle?: string;
  backHref?: string;
  backLabel?: string;
  children: React.ReactNode;
};

export function PageShell({
  title,
  subtitle,
  backHref,
  backLabel = "Back",
  children,
}: PageShellProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-4 sm:px-6">
      <header className="mb-4 rounded-[28px] border border-white/70 bg-white/90 px-5 py-5 shadow-sm ring-1 ring-slate-950/5 backdrop-blur">
        {backHref ? (
          <Link
            href={backHref}
            className="mb-4 inline-flex h-10 items-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            {backLabel}
          </Link>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
        {subtitle ? <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{subtitle}</p> : null}
      </header>
      <div className="flex flex-1 flex-col gap-4">{children}</div>
    </main>
  );
}
