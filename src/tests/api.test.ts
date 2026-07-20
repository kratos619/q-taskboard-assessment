import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/jwt";

// Mock the DB layer so route handlers run without Postgres.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    membership: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    task: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    $queryRawUnsafe: vi.fn(),
  },
}));

import { prisma } from "@/lib/prisma";
import { GET as tasksGET } from "@/app/api/projects/[id]/tasks/route";
import { GET as projectGET } from "@/app/api/projects/[id]/route";
import { PATCH as taskPATCH } from "@/app/api/tasks/[id]/route";
import { POST as loginPOST } from "@/app/api/auth/login/route";

const p = prisma as unknown as {
  user: { findUnique: any; findFirst: any };
  membership: { findUnique: any };
  project: { findUnique: any };
  task: { findUnique: any; findMany: any; update: any };
  $queryRawUnsafe: any;
};

const USER = { id: "u1", email: "a@b.com", name: "Ann" };
const TOKEN = signToken({ userId: USER.id, email: USER.email });

function req(url: string, opts: { method?: string; body?: unknown; ip?: string } = {}) {
  const headers = new Headers({ authorization: `Bearer ${TOKEN}` });
  if (opts.body) headers.set("content-type", "application/json");
  if (opts.ip) headers.set("x-forwarded-for", opts.ip);
  return new NextRequest(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  // getCurrentUser -> resolves the authed user
  p.user.findUnique.mockResolvedValue(USER);
});

describe("Issue 1: task search is not SQL-injectable", () => {
  it("passes the search term as a parameterized value, never raw SQL", async () => {
    p.membership.findUnique.mockResolvedValue({ role: "member" });
    p.task.findMany.mockResolvedValue([]);

    const evil = "' OR 1=1; DROP TABLE users;--";
    const res = await tasksGET(
      req(`http://localhost/api/projects/p1/tasks?q=${encodeURIComponent(evil)}`),
      params("p1")
    );

    expect(res.status).toBe(200);
    expect(p.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(p.task.findMany).toHaveBeenCalledTimes(1);
    // the raw term is handed to Prisma as data, not concatenated into SQL
    expect(JSON.stringify(p.task.findMany.mock.calls[0][0])).toContain(evil);
  });
});

describe("Issue 2: project detail never leaks password hashes", () => {
  it("does not request passwordHash from the database", async () => {
    p.membership.findUnique.mockResolvedValue({ role: "member" });
    p.project.findUnique.mockResolvedValue({ id: "p1", name: "P", tasks: [], memberships: [] });

    await projectGET(req("http://localhost/api/projects/p1"), params("p1"));

    expect(p.project.findUnique).toHaveBeenCalledTimes(1);
    const arg = JSON.stringify(p.project.findUnique.mock.calls[0][0]);
    expect(arg).not.toContain("passwordHash");
    // and it must not blindly include full user rows
    expect(arg).not.toMatch(/"(owner|user|assignee|createdBy)"\s*:\s*true/);
  });
});

describe("Issue 3: viewers cannot update tasks (authorization enforced)", () => {
  it("rejects a viewer with 403 and never writes", async () => {
    p.task.findUnique.mockResolvedValue({ id: "t1", projectId: "p1" });
    p.membership.findUnique.mockResolvedValue({ role: "viewer" });

    const res = await taskPATCH(
      req("http://localhost/api/tasks/t1", { method: "PATCH", body: { title: "hacked" } }),
      params("t1")
    );

    expect(res.status).toBe(403);
    expect(p.task.update).not.toHaveBeenCalled();
  });

  it("allows a member to update", async () => {
    p.task.findUnique.mockResolvedValue({ id: "t1", projectId: "p1" });
    p.membership.findUnique.mockResolvedValue({ role: "member" });
    p.task.update.mockResolvedValue({ id: "t1", title: "ok" });

    const res = await taskPATCH(
      req("http://localhost/api/tasks/t1", { method: "PATCH", body: { title: "ok" } }),
      params("t1")
    );

    expect(res.status).toBe(200);
    expect(p.task.update).toHaveBeenCalledTimes(1);
  });
});

describe("Issue 4: login is rate limited", () => {
  it("returns 429 after too many attempts from one IP", async () => {
    p.user.findFirst.mockResolvedValue(null); // invalid credentials every time

    const ip = "203.0.113.7";
    const attempt = () =>
      loginPOST(req("http://localhost/api/auth/login", {
        method: "POST",
        body: { email: "a@b.com", password: "wrongpass" },
        ip,
      }));

    let last = 401;
    for (let i = 0; i < 12; i++) {
      last = (await attempt()).status;
    }
    expect(last).toBe(429);
  });
});
