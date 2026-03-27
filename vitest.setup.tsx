import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: unknown;
    children: React.ReactNode;
  }) => {
    const resolvedHref =
      typeof href === "string"
        ? href
        : href && typeof href === "object" && "pathname" in href
          ? String((href as { pathname?: string }).pathname ?? "#")
          : "#";

    return React.createElement(
      "a",
      {
        href: resolvedHref,
        ...props,
      },
      children,
    );
  },
}));
