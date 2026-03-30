"use client";

type PresentTotalPillProps = {
  presentCount: number;
  totalCount: number;
  className?: string;
};

export function PresentTotalPill({
  presentCount,
  totalCount,
  className,
}: PresentTotalPillProps) {
  return (
    <div
      aria-label={`${presentCount} of ${totalCount} students marked present`}
      className={`inline-flex shrink-0 items-stretch overflow-hidden rounded-full bg-slate-950 text-white shadow-sm ${className ?? ""}`.trim()}
    >
      <span className="flex min-w-14 items-center justify-center bg-emerald-100 px-4 py-2 text-2xl font-semibold leading-none text-emerald-800">
        {presentCount}
      </span>
      <span className="flex min-w-12 items-center justify-center border-l border-slate-700 bg-slate-700 px-4 py-2 text-lg font-medium leading-none text-slate-200">
        {totalCount}
      </span>
    </div>
  );
}
