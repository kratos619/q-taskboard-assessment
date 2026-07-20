import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/jwt";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    membership: { findUnique: vi.fn() },
    task: { findUnique: vi.fn() },
    comment: { findMany: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { GET as commentsGET, POST as commentsPOST } from "@/app/api/tasks/[id]/comments/route";

const p = prisma as unknown as {
  user: { findUnique: any };
  membership: { findUnique: any };
  task: { findUnique: any };
  comment: { findMany: any; create: any };
};

const USER = { id: "u1", email: "a@b.com", name: "Ann" };
const TOKEN = signToken({ userId: USER.id, email: USER.email });

function req(body?: unknown) {
  const headers = new Headers({ authorization: `Bearer ${TOKEN}` });
  if (body) headers.set("content-type", "application/json");
  return new NextRequest("http://localhost/api/tasks/t1/comments", {
    method: body ? "POST" : "GET",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}
const params = { params: Promise.resolve({ id: "t1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  p.user.findUnique.mockResolvedValue(USER);
  p.task.findUnique.mockResolvedValue({ id: "t1", projectId: "p1" });
});

describe("GET /api/tasks/[id]/comments", () => {
  it("returns comments chronologically for a project member (viewer allowed)", async () => {
    p.membership.findUnique.mockResolvedValue({ role: "viewer" });
    p.comment.findMany.mockResolvedValue([
      { id: "c1", body: "first", createdAt: "2026-01-01", author: USER },
    ]);

    const res = await commentsGET(req(), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.comments).toHaveLength(1);
    // oldest-first ordering requested from the DB
    expect(p.comment.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: "asc" });
  });

  it("forbids a non-member", async () => {
    p.membership.findUnique.mockResolvedValue(null);
    const res = await commentsGET(req(), params);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/tasks/[id]/comments", () => {
  it("lets a member post and returns 201", async () => {
    p.membership.findUnique.mockResolvedValue({ role: "member" });
    p.comment.create.mockResolvedValue({ id: "c9", body: "hello", author: USER });

    const res = await commentsPOST(req({ body: "hello" }), params);

    expect(res.status).toBe(201);
    expect(p.comment.create).toHaveBeenCalledTimes(1);
    expect(p.comment.create.mock.calls[0][0].data).toMatchObject({
      taskId: "t1",
      authorId: "u1",
      body: "hello",
    });
  });

  it("forbids a viewer from posting", async () => {
    p.membership.findUnique.mockResolvedValue({ role: "viewer" });

    const res = await commentsPOST(req({ body: "nope" }), params);

    expect(res.status).toBe(403);
    expect(p.comment.create).not.toHaveBeenCalled();
  });

  it("rejects an empty body with 400", async () => {
    p.membership.findUnique.mockResolvedValue({ role: "member" });

    const res = await commentsPOST(req({ body: "" }), params);

    expect(res.status).toBe(400);
    expect(p.comment.create).not.toHaveBeenCalled();
  });
});
