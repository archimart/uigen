// @vitest-environment node
import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { decodeJwt, decodeProtectedHeader } from "jose";

vi.mock("server-only", () => ({}));

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

import { createSession, getSession, deleteSession, verifySession } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createSession", () => {
  function captureSetCall() {
    let name = "", token = "", options: Record<string, unknown> = {};
    mockCookieStore.set.mockImplementation((n: string, t: string, o: Record<string, unknown>) => {
      name = n; token = t; options = o;
    });
    return () => ({ name, token, options });
  }

  test("sets the cookie with name 'auth-token'", async () => {
    const get = captureSetCall();
    await createSession("user-123", "test@example.com");
    expect(get().name).toBe("auth-token");
  });

  test("token is a compact JWT (three base64url segments)", async () => {
    const get = captureSetCall();
    await createSession("user-123", "test@example.com");
    const parts = get().token.split(".");
    expect(parts).toHaveLength(3);
    parts.forEach((part) => expect(part).toMatch(/^[A-Za-z0-9_-]+$/));
  });

  test("JWT header uses HS256 algorithm", async () => {
    const get = captureSetCall();
    await createSession("user-123", "test@example.com");
    const header = decodeProtectedHeader(get().token);
    expect(header.alg).toBe("HS256");
  });

  test("JWT payload contains correct userId and email", async () => {
    const get = captureSetCall();
    await createSession("user-123", "test@example.com");
    const payload = decodeJwt(get().token);
    expect(payload.userId).toBe("user-123");
    expect(payload.email).toBe("test@example.com");
  });

  test("cookie expires approximately 7 days from now", async () => {
    const before = Date.now();
    const get = captureSetCall();
    await createSession("user-123", "test@example.com");
    const after = Date.now();

    const expires = (get().options.expires as Date).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(expires).toBeGreaterThanOrEqual(before + sevenDays - 1000);
    expect(expires).toBeLessThanOrEqual(after + sevenDays + 1000);
  });

  test("cookie is httpOnly with path '/' and sameSite 'lax'", async () => {
    const get = captureSetCall();
    await createSession("user-123", "test@example.com");
    const { options } = get();
    expect(options.httpOnly).toBe(true);
    expect(options.path).toBe("/");
    expect(options.sameSite).toBe("lax");
  });

  test("secure is false outside production", async () => {
    const get = captureSetCall();
    await createSession("user-123", "test@example.com");
    expect(get().options.secure).toBe(false);
  });

  test("secure is true in production", async () => {
    const original = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    const get = captureSetCall();
    await createSession("user-123", "test@example.com");
    (process.env as Record<string, string>).NODE_ENV = original;
    expect(get().options.secure).toBe(true);
  });

  test("embeds different userId and email for each user", async () => {
    const get = captureSetCall();
    await createSession("admin-999", "admin@example.com");
    const payload = decodeJwt(get().token);
    expect(payload.userId).toBe("admin-999");
    expect(payload.email).toBe("admin@example.com");
  });
});

describe("getSession", () => {
  test("returns null when no cookie is present", async () => {
    mockCookieStore.get.mockReturnValue(undefined);
    expect(await getSession()).toBeNull();
  });

  test("returns null for an invalid token", async () => {
    mockCookieStore.get.mockReturnValue({ value: "not.a.jwt" });
    expect(await getSession()).toBeNull();
  });

  test("returns session payload for a valid token", async () => {
    let capturedToken = "";
    mockCookieStore.set.mockImplementation((_name: string, token: string) => {
      capturedToken = token;
    });
    await createSession("user-123", "test@example.com");

    mockCookieStore.get.mockReturnValue({ value: capturedToken });
    const session = await getSession();

    expect(session?.userId).toBe("user-123");
    expect(session?.email).toBe("test@example.com");
  });
});

describe("deleteSession", () => {
  test("deletes the auth cookie", async () => {
    await deleteSession();
    expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
  });
});

describe("verifySession", () => {
  test("returns null when no cookie is present", async () => {
    const request = new NextRequest("http://localhost:3000");
    expect(await verifySession(request)).toBeNull();
  });

  test("returns null for an invalid token", async () => {
    const request = new NextRequest("http://localhost:3000", {
      headers: { cookie: "auth-token=not.a.jwt" },
    });
    expect(await verifySession(request)).toBeNull();
  });

  test("returns session payload for a valid token", async () => {
    let capturedToken = "";
    mockCookieStore.set.mockImplementation((_name: string, token: string) => {
      capturedToken = token;
    });
    await createSession("user-456", "verify@example.com");

    const request = new NextRequest("http://localhost:3000", {
      headers: { cookie: `auth-token=${capturedToken}` },
    });
    const session = await verifySession(request);

    expect(session?.userId).toBe("user-456");
    expect(session?.email).toBe("verify@example.com");
  });
});
