import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./dialog";

describe("Dialog", () => {
  it("does not close when clicking inside the dialog panel", () => {
    const onClose = vi.fn();

    render(
      <Dialog open onClose={onClose}>
        <div>Dialog body</div>
      </Dialog>,
    );

    fireEvent.click(screen.getByText("Dialog body"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when clicking the overlay", () => {
    const onClose = vi.fn();

    render(
      <Dialog open onClose={onClose}>
        <div>Dialog body</div>
      </Dialog>,
    );

    const overlay = screen.getByRole("dialog").parentElement;
    expect(overlay).not.toBeNull();

    fireEvent.click(overlay!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
