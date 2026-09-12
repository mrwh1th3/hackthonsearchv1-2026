// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DELETE, POST } from "./route";
import { SESSION_COOKIE } from "@/lib/auth/session";

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/session (login demo, 15 §4)", () => {
  it("credenciales correctas (auditor/1234): 200 y cookie de sesión HttpOnly", async () => {
    const res = await POST(req({ usuario: "auditor", password: "1234" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=lax");
  });

  it("credenciales incorrectas: 401, sin cookie de sesión", async () => {
    const res = await POST(req({ usuario: "auditor", password: "no-es-la-clave" }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("credenciales_invalidas");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("usuario distinto de auditor: 401 aunque la contraseña sea correcta", async () => {
    const res = await POST(req({ usuario: "otro", password: "1234" }));
    expect(res.status).toBe(401);
  });

  it("origen cruzado (Origin no coincide con Host): 403 antes de evaluar credenciales", async () => {
    const res = await POST(req({ usuario: "auditor", password: "1234" }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/session (logout)", () => {
  it("invalida la cookie (maxAge 0)", async () => {
    const res = await DELETE(
      new Request("http://localhost:3000/api/session", {
        method: "DELETE",
        headers: { host: "localhost:3000", origin: "http://localhost:3000" },
      }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toMatch(/Max-Age=0/i);
  });
});
