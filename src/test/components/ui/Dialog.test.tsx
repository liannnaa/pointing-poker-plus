import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

describe("DialogTrigger", () => {
  it("renders with data-slot='dialog-trigger'", () => {
    const { container } = render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
      </Dialog>
    );
    const el = container.querySelector('[data-slot="dialog-trigger"]');
    expect(el).toBeInTheDocument();
  });

  it("renders trigger button text", () => {
    render(
      <Dialog>
        <DialogTrigger>Open Dialog</DialogTrigger>
      </Dialog>
    );
    expect(screen.getByText("Open Dialog")).toBeInTheDocument();
  });
});

describe("DialogClose", () => {
  it("renders its children text", () => {
    // Base UI portals content — query document rather than container
    render(
      <Dialog open={true}>
        <DialogContent showCloseButton={false}>
          <DialogClose>Dismiss</DialogClose>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
  });

  it("renders close button text", () => {
    render(
      <Dialog open={true}>
        <DialogContent showCloseButton={false}>
          <DialogClose>Close me</DialogClose>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByText("Close me")).toBeInTheDocument();
  });
});

describe("DialogHeader", () => {
  it("renders with data-slot='dialog-header'", () => {
    const { container } = render(
      <Dialog open={true}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>Header content</DialogHeader>
        </DialogContent>
      </Dialog>
    );
    const el =
      container.querySelector('[data-slot="dialog-header"]') ||
      document.querySelector('[data-slot="dialog-header"]');
    expect(el).toBeInTheDocument();
  });
});

describe("DialogTitle", () => {
  it("renders its text content", () => {
    render(
      <Dialog open={true}>
        <DialogContent showCloseButton={false}>
          <DialogTitle>My Dialog Title</DialogTitle>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByText("My Dialog Title")).toBeInTheDocument();
  });
});

describe("DialogDescription", () => {
  it("renders its text content", () => {
    render(
      <Dialog open={true}>
        <DialogContent showCloseButton={false}>
          <DialogDescription>Some description text</DialogDescription>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByText("Some description text")).toBeInTheDocument();
  });
});

describe("DialogContent", () => {
  it("renders children when open", () => {
    render(
      <Dialog open={true}>
        <DialogContent showCloseButton={false}>
          <p>Dialog body</p>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByText("Dialog body")).toBeInTheDocument();
  });

  it("shows close button by default (showCloseButton=true)", () => {
    render(
      <Dialog open={true}>
        <DialogContent>
          <p>Content</p>
        </DialogContent>
      </Dialog>
    );
    const closeBtn = document.querySelector('[data-slot="dialog-close"]');
    expect(closeBtn).toBeInTheDocument();
  });

  it("does not render X close button when showCloseButton=false", () => {
    render(
      <Dialog open={true}>
        <DialogContent showCloseButton={false}>
          <p>Content without close</p>
        </DialogContent>
      </Dialog>
    );
    // There should be no sr-only Close text when showCloseButton is false
    const srClose = screen.queryByText("Close");
    expect(srClose).not.toBeInTheDocument();
  });
});

describe("DialogFooter", () => {
  it("renders children with data-slot='dialog-footer'", () => {
    const { container } = render(
      <Dialog open={true}>
        <DialogContent showCloseButton={false}>
          <DialogFooter>
            <button>Save</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
    const footer =
      container.querySelector('[data-slot="dialog-footer"]') ||
      document.querySelector('[data-slot="dialog-footer"]');
    expect(footer).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("does not render a Close button when showCloseButton=false (default)", () => {
    render(
      <Dialog open={true}>
        <DialogContent showCloseButton={false}>
          <DialogFooter showCloseButton={false}>
            <button>Submit</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
    // Only the Submit button should exist; no "Close" text from footer
    expect(screen.getByText("Submit")).toBeInTheDocument();
    expect(screen.queryByText("Close")).not.toBeInTheDocument();
  });

  it("renders a Close button when showCloseButton=true", () => {
    render(
      <Dialog open={true}>
        <DialogContent showCloseButton={false}>
          <DialogFooter showCloseButton={true}>
            <button>Submit</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
    expect(screen.getByText("Close")).toBeInTheDocument();
  });
});
