import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoLogin, safeNextPath } from "./demo-login";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), next: null as string | null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, refresh: navigation.refresh }),
  useSearchParams: () => ({ get: () => navigation.next }),
}));

const fetchMock = vi.fn<typeof fetch>();
function response(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function fillPassword(password = "1234") {
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
}
function submit() {
  fireEvent.submit(screen.getByRole("form", { name: "Sign in" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  navigation.next = null;
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("local sign-in destination", () => {
  it.each([null, "https://example.com", "//example.com", "/\\example.com", "javascript:alert(1)", "/%2f%2fexample.com", "/%5cexample.com", "/%0a/evil", "/bad%escape", "/a/..//example.com", "/%2e%2e//example.com"])("rejects unsafe destination %s", (next) => {
    expect(safeNextPath(next)).toBe("/");
  });

  it("preserves a local investigation query and hash", () => {
    expect(safeNextPath("/?corrida=example&run=123#evidence")).toBe("/?corrida=example&run=123#evidence");
    expect(safeNextPath("/hypotheses")).toBe("/hypotheses");
  });
});

describe("DemoLogin", () => {
  it("offers English labels and accessible workflow controls", async () => {
    const user = userEvent.setup();
    render(<DemoLogin />);
    expect(screen.getByLabelText("Username")).toHaveValue("auditor");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByRole("button", { name: "01 Records" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "02 Investigate" }));
    expect(screen.getByRole("button", { name: "02 Investigate" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Question every signal." })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can fill demo credentials without signing in and toggle password visibility", async () => {
    const user = userEvent.setup();
    render(<DemoLogin />);
    await user.click(screen.getByRole("button", { name: "Use demo credentials" }));
    expect(screen.getByLabelText("Password")).toHaveValue("1234");
    expect(screen.getByLabelText("Password")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates and focuses a missing field before contacting the server", () => {
    render(<DemoLogin />);
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your password.");
    expect(screen.getByLabelText("Password")).toHaveFocus();
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "false");
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "  " } });
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your username and password.");
    expect(screen.getByLabelText("Username")).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the existing auth contract and redirects only after success", async () => {
    navigation.next = "/?corrida=example&run=123";
    fetchMock.mockResolvedValueOnce(response(200, { ok: true }));
    render(<DemoLogin />);
    fillPassword(" password with spaces ");
    submit();
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/?corrida=example&run=123"));
    expect(fetchMock).toHaveBeenCalledWith("/api/session", expect.objectContaining({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usuario: "auditor", password: " password with spaces " }),
      signal: expect.any(AbortSignal),
    }));
    expect(navigation.refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Opening workspace…" })).toBeDisabled();
  });

  it("does not send successful sessions to an external next destination", async () => {
    navigation.next = "//example.com";
    fetchMock.mockResolvedValueOnce(response(200));
    render(<DemoLogin />);
    fillPassword();
    submit();
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/"));
  });

  it("prevents duplicate requests while sign-in is pending", async () => {
    let resolveRequest!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve; }));
    render(<DemoLogin />);
    fillPassword();
    submit();
    submit();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    expect(screen.getByRole("form", { name: "Sign in" })).toHaveAttribute("aria-busy", "true");
    expect(navigation.push).not.toHaveBeenCalled();
    await act(async () => resolveRequest(response(401, { error: "credenciales_invalidas" })));
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it.each([
    [401, "credenciales_invalidas", "Incorrect username or password."],
    [503, "fuente_de_datos_no_disponible", "Your credentials were accepted, but the workspace could not be loaded."],
    [503, "sesion_no_configurada", "Sign-in is not configured for this workspace."],
    [403, "origen_no_permitido", "This sign-in request was not allowed."],
    [500, "private implementation detail", "Could not sign in."],
  ])("shows a truthful English error for status %s / %s", async (status, error, copy) => {
    fetchMock.mockResolvedValueOnce(response(status, { error }));
    render(<DemoLogin />);
    fillPassword();
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
    expect(screen.queryByText(/Signed in,/)).not.toBeInTheDocument();
    expect(screen.queryByText("private implementation detail")).not.toBeInTheDocument();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("respects the server rate-limit countdown before permitting another request", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(response(429, { error: "demasiados_intentos", retry_after_ms: 2_000 }));
    render(<DemoLogin />);
    fillPassword();
    await act(async () => submit());
    expect(screen.getByRole("button", { name: "Try again in 2s" })).toBeDisabled();
    submit();
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("recovers after a network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network error"));
    render(<DemoLogin />);
    fillPassword();
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not connect. Check your connection and try again.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("times out a stalled request and re-enables the form", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    render(<DemoLogin />);
    fillPassword();
    submit();
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
    expect(screen.getByRole("alert")).toHaveTextContent("The request took too long. Please try again.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(navigation.push).not.toHaveBeenCalled();
  });
});
