import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "outline" | "danger";
type ButtonSize = "sm" | "md";

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function buttonVariants({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return cn(
    "inline-flex items-center justify-center rounded-full font-medium transition disabled:cursor-not-allowed",
    size === "sm" ? "h-10 px-4 text-sm" : "h-11 px-4 text-sm",
    variant === "primary" &&
      "bg-slate-950 text-white hover:bg-slate-800 disabled:bg-slate-300",
    variant === "outline" &&
      "border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:text-slate-950 disabled:border-slate-200 disabled:text-slate-400",
    variant === "danger" &&
      "bg-rose-600 text-white hover:bg-rose-500 disabled:bg-rose-200",
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  );
}
