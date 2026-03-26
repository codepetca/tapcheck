import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type PageShellProps = {
  title: React.ReactNode;
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
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-2 sm:px-6">
      <Card as="header" className="mb-4 px-4 py-3 backdrop-blur">
        <div className="relative min-h-11">
          {backHref ? (
            <Link
              href={backHref}
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className:
                  "absolute left-0 top-1/2 -translate-y-1/2 shrink-0 border-slate-200 px-3 text-slate-600 hover:text-slate-900",
              })}
            >
              <ChevronLeft aria-hidden="true" className="mr-1 h-4 w-4" />
              {backLabel}
            </Link>
          ) : null}
          <div className="px-20 text-center">
            <h1 className="font-heading text-xl font-semibold tracking-tight text-slate-950">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1 max-w-2xl text-sm leading-5 text-slate-600">{subtitle}</p>
            ) : null}
          </div>
        </div>
      </Card>
      <div className="flex flex-1 flex-col gap-4">{children}</div>
    </main>
  );
}
