import Link from "next/link";

export function AuthShell({
  eyebrow,
  title,
  subtitle,
  bare = false,
  children,
}: {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  bare?: boolean;
  children: React.ReactNode;
}) {
  const hasHeader = Boolean(eyebrow || title || subtitle);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10 sm:px-6">
      <div className="w-full">
        {hasHeader ? (
          <div className="mb-8">
            <Link
              href="/"
              className="inline-flex text-sm font-medium tracking-[0.18em] text-emerald-700 uppercase"
            >
              Tapcheck
            </Link>
            {eyebrow ? (
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight text-slate-950">
                {title}
              </h1>
            ) : null}
            {subtitle ? (
              <p className="mt-3 max-w-sm text-sm leading-6 text-slate-600">{subtitle}</p>
            ) : null}
          </div>
        ) : null}

        {bare ? children : (
          <div className="rounded-[28px] border border-white/70 bg-white/92 p-3 shadow-sm ring-1 ring-slate-950/5 sm:p-4">
            {children}
          </div>
        )}
      </div>
    </main>
  );
}
