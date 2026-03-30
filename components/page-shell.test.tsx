import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PageShell } from "./page-shell";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/clerk-header-controls", () => ({
  ClerkHeaderControls: () => null,
}));

describe("PageShell", () => {
  it("keeps the back control labeled while hiding the text on small screens", () => {
    render(
      <PageShell title="Roster" backHref="/" backLabel="Back">
        <div>Body</div>
      </PageShell>,
    );

    const backLink = screen.getByRole("link", { name: "Back" });
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveAttribute("title", "Back");
    expect(backLink.querySelector("span")).toHaveClass("hidden", "sm:inline");
    expect(backLink.querySelector("svg")).toHaveClass("h-5", "w-5");
  });
});
