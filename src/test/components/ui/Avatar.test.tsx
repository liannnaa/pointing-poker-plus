import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";

describe("Avatar", () => {
  it("renders with default size and data-slot attribute", () => {
    const { container } = render(<Avatar />);
    const el = container.querySelector('[data-slot="avatar"]');
    expect(el).toBeInTheDocument();
  });

  it("sets data-size='sm' when size prop is sm", () => {
    const { container } = render(<Avatar size="sm" />);
    const el = container.querySelector('[data-slot="avatar"]');
    expect(el).toHaveAttribute("data-size", "sm");
  });

  it("sets data-size='lg' when size prop is lg", () => {
    const { container } = render(<Avatar size="lg" />);
    const el = container.querySelector('[data-slot="avatar"]');
    expect(el).toHaveAttribute("data-size", "lg");
  });

  it("sets data-size='default' when no size prop given", () => {
    const { container } = render(<Avatar />);
    const el = container.querySelector('[data-slot="avatar"]');
    expect(el).toHaveAttribute("data-size", "default");
  });
});

describe("AvatarFallback", () => {
  it("renders fallback text with data-slot='avatar-fallback'", () => {
    const { container } = render(
      <Avatar>
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>
    );
    const el = container.querySelector('[data-slot="avatar-fallback"]');
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("AB");
  });
});

describe("AvatarImage", () => {
  // Base UI's AvatarPrimitive.Image only renders an <img> after the image
  // has loaded (progressive enhancement). In jsdom there is no image loading,
  // so we verify the component mounts without error and the fallback is visible.
  it("mounts without crashing alongside AvatarFallback", () => {
    const { container } = render(
      <Avatar>
        <AvatarImage src="https://example.com/photo.png" alt="Test user" />
        <AvatarFallback>TU</AvatarFallback>
      </Avatar>
    );
    // The avatar root must be present
    expect(container.querySelector('[data-slot="avatar"]')).toBeInTheDocument();
    // Fallback is shown while image hasn't loaded
    expect(container.querySelector('[data-slot="avatar-fallback"]')).toBeInTheDocument();
  });
});

describe("AvatarBadge", () => {
  it("renders with data-slot='avatar-badge'", () => {
    const { container } = render(
      <Avatar>
        <AvatarBadge />
      </Avatar>
    );
    const el = container.querySelector('[data-slot="avatar-badge"]');
    expect(el).toBeInTheDocument();
  });

  it("renders children inside the badge", () => {
    const { container } = render(
      <Avatar>
        <AvatarBadge>3</AvatarBadge>
      </Avatar>
    );
    const el = container.querySelector('[data-slot="avatar-badge"]');
    expect(el).toHaveTextContent("3");
  });

  it("accepts and applies custom className", () => {
    const { container } = render(
      <Avatar>
        <AvatarBadge className="custom-class" />
      </Avatar>
    );
    const el = container.querySelector('[data-slot="avatar-badge"]');
    expect(el).toHaveClass("custom-class");
  });
});

describe("AvatarGroup", () => {
  it("renders with data-slot='avatar-group'", () => {
    const { container } = render(
      <AvatarGroup>
        <Avatar />
      </AvatarGroup>
    );
    const el = container.querySelector('[data-slot="avatar-group"]');
    expect(el).toBeInTheDocument();
  });

  it("renders children inside the group", () => {
    render(
      <AvatarGroup>
        <Avatar>
          <AvatarFallback>A1</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>A2</AvatarFallback>
        </Avatar>
      </AvatarGroup>
    );
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.getByText("A2")).toBeInTheDocument();
  });
});

describe("AvatarGroupCount", () => {
  it("renders with data-slot='avatar-group-count'", () => {
    const { container } = render(
      <AvatarGroup>
        <AvatarGroupCount>+5</AvatarGroupCount>
      </AvatarGroup>
    );
    const el = container.querySelector('[data-slot="avatar-group-count"]');
    expect(el).toBeInTheDocument();
  });

  it("renders children inside the group count", () => {
    render(
      <AvatarGroup>
        <AvatarGroupCount>+5</AvatarGroupCount>
      </AvatarGroup>
    );
    expect(screen.getByText("+5")).toBeInTheDocument();
  });
});
