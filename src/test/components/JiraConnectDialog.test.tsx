import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { JiraConnectDialog } from "@/components/room/JiraConnectDialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /connect jira/i }));
}

function fillForm({
  email = "a@b.com",
  token = "mytoken",
  baseUrl = "https://co.atlassian.net",
  projectKey = "",
}: {
  email?: string;
  token?: string;
  baseUrl?: string;
  projectKey?: string;
} = {}) {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/api token/i), { target: { value: token } });
  fireEvent.change(screen.getByLabelText(/jira base url/i), { target: { value: baseUrl } });
  if (projectKey) {
    fireEvent.change(screen.getByLabelText(/project key/i), {
      target: { value: projectKey },
    });
  }
}

describe("JiraConnectDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Renders "Connect Jira" button
  it("renders the Connect Jira button", () => {
    render(<JiraConnectDialog onConnected={vi.fn()} />);
    expect(screen.getByRole("button", { name: /connect jira/i })).toBeInTheDocument();
  });

  // 2. Clicking "Connect Jira" opens the dialog
  it("clicking Connect Jira opens the dialog with heading", () => {
    render(<JiraConnectDialog onConnected={vi.fn()} />);
    openDialog();
    expect(screen.getByText("Connect to Jira")).toBeInTheDocument();
  });

  // 3. Submitting with all fields calls fetch with correct body
  it("submitting calls fetch with correct body", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ email: "a@b.com", base_url: "https://co.atlassian.net" }),
    });

    render(<JiraConnectDialog onConnected={vi.fn()} />);
    openDialog();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/jira/connect",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "a@b.com",
            token: "mytoken",
            base_url: "https://co.atlassian.net",
          }),
        })
      );
    });
  });

  // 4. On success: calls onConnected with { email, base_url } and shows toast.success
  it("on success calls onConnected with email and base_url and shows toast.success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ email: "a@b.com", base_url: "https://co.atlassian.net" }),
    });

    const onConnected = vi.fn();
    render(<JiraConnectDialog onConnected={onConnected} />);
    openDialog();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledWith({
        email: "a@b.com",
        base_url: "https://co.atlassian.net",
      });
      expect(toast.success).toHaveBeenCalledWith("Connected to Jira");
    });
  });

  // 5. On fetch error (res.ok = false): calls toast.error with the error message
  it("on res.ok=false calls toast.error with the error message", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Invalid credentials" }),
    });

    render(<JiraConnectDialog onConnected={vi.fn()} />);
    openDialog();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Invalid credentials");
    });
  });

  // 6. On network error (fetch throws): calls toast.error
  it("on network error calls toast.error", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

    render(<JiraConnectDialog onConnected={vi.fn()} />);
    openDialog();
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Network failure");
    });
  });

  // 7. Project key is included in the request body when provided (uppercased)
  it("includes project_key uppercased when provided", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ email: "a@b.com", base_url: "https://co.atlassian.net" }),
    });

    render(<JiraConnectDialog onConnected={vi.fn()} />);
    openDialog();
    fillForm({ projectKey: "mts6" });
    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/jira/connect",
        expect.objectContaining({
          body: JSON.stringify({
            email: "a@b.com",
            token: "mytoken",
            base_url: "https://co.atlassian.net",
            project_key: "MTS6",
          }),
        })
      );
    });
  });

  // 8. Project key is omitted when left empty
  it("omits project_key when left empty", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ email: "a@b.com", base_url: "https://co.atlassian.net" }),
    });

    render(<JiraConnectDialog onConnected={vi.fn()} />);
    openDialog();
    fillForm(); // no projectKey
    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }));

    await waitFor(() => {
      const callBody = JSON.parse(
        (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body
      );
      expect(callBody).not.toHaveProperty("project_key");
    });
  });
});
