import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

type CardVariant = "default" | "subtle" | "success" | "danger";
type CardElement = "section" | "div" | "header";

type CardProps = ComponentPropsWithoutRef<"section"> & {
  as?: CardElement;
  variant?: CardVariant;
};

export function Card({
  as = "section",
  variant = "default",
  className,
  ...props
}: CardProps) {
  const Comp = as;

  return (
    <Comp
      className={cn(
        "rounded-[28px] p-5 shadow-sm",
        variant === "default" &&
          "border border-white/70 bg-white/90 ring-1 ring-slate-950/5",
        variant === "subtle" && "border border-slate-200 bg-slate-50/90",
        variant === "success" && "border border-emerald-200 bg-emerald-50/80",
        variant === "danger" && "border border-rose-200 bg-rose-50/80",
        className,
      )}
      {...props}
    />
  );
}
