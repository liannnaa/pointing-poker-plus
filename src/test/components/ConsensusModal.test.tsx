import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConsensusModal } from "@/components/room/ConsensusModal";

describe("ConsensusModal", () => {
  it("renders the celebration image", () => {
    render(<ConsensusModal onDismiss={vi.fn()} />);
    const img = screen.getByRole("img", { name: /consensus celebration/i });
    expect(img).toBeInTheDocument();
  });

  it("renders the consensus label", () => {
    render(<ConsensusModal onDismiss={vi.fn()} />);
    expect(screen.getByText(/consensus/i)).toBeInTheDocument();
  });

  it("calls onDismiss when the screen is clicked", () => {
    const onDismiss = vi.fn();
    render(<ConsensusModal onDismiss={onDismiss} />);
    fireEvent.click(window);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("applies animation classes to backdrop and card", () => {
    render(<ConsensusModal onDismiss={vi.fn()} />);
    const backdrop = screen.getByRole("img", { name: /consensus celebration/i })
      .closest(".consensus-backdrop");
    expect(backdrop).toBeInTheDocument();

    const card = screen.getByRole("img", { name: /consensus celebration/i })
      .closest(".consensus-card");
    expect(card).toBeInTheDocument();
  });

  it("removes the click listener on unmount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = render(<ConsensusModal onDismiss={vi.fn()} />);
    unmount();

    const addedHandler = addSpy.mock.calls.find(([event]) => event === "click")?.[1];
    const removedHandler = removeSpy.mock.calls.find(([event]) => event === "click")?.[1];
    expect(addedHandler).toBeDefined();
    expect(addedHandler).toBe(removedHandler);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
