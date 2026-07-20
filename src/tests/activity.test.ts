import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/jwt";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    membership: { findUnique: vi.fn() },
    activity: { findMany: vi.fn(), create: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { GET as activityGET } from "@/app/api/projects/[id]/activity/route";
import { logActivity } from "@/lib/activity";

const p = prisma as unknown as {
  user: { findUnique: any };
  membership: { findUnique: any };
  activity: { findMany: any; create: any };
};

const USER = { id: "u1", email: "a@b.com", name: "Ann" };
const TOKEN = signToken({ userId: USER.id, email: USER.email });

function req() {
  return new NextRequest("http://localhost/api/projects/p1/activity", {
    headers: new Headers({ authorization: `Bearer ${TOKEN}` }),
  });
}
const params = { params: Promise.resolve({ id: "p1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  p.user.findUnique.mockResolvedValue(USER);
});

describe("GET /api/projects/[id]/activity", () => {
  it("returns activity newest-first for a member", async () => {
    p.membership.findUnique.mockResolvedValue({ role: "viewer" });
    p.activity.findMany.mockResolvedValue([
      { id: "a1", action: "task_created", createdAt: "2026-01-02", actor: USER },
    ]);

    const res = await activityGET(req(), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.activities).toHaveLength(1);
    expect(p.activity.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: "desc" });
    expect(p.activity.findMany.mock.calls[0][0].where).toEqual({ projectId: "p1" });
  });

  it("forbids a non-member", async () => {
    p.membership.findUnique.mockResolvedValue(null);
    const res = await activityGET(req(), params);
    expect(res.status).toBe(403);
  });
});

describe("logActivity (best-effort)", () => {
  it("writes an activity record", async () => {
    p.activity.create.mockResolvedValue({ id: "a1" });
    await logActivity({ projectId: "p1", actorId: "u1", action: "task_created", taskId: "t1", detail: "X" });
    expect(p.activity.create).toHaveBeenCalledTimes(1);
    expect(p.activity.create.mock.calls[0][0].data).toMatchObject({
      projectId: "p1",
      actorId: "u1",
      action: "task_created",
    });
  });

  it("never throws when the write fails (feed is off the hot path)", async () => {
    p.activity.create.mockRejectedValue(new Error("db down"));
    await expect(
      logActivity({ projectId: "p1", actorId: "u1", action: "comment_added" })
    ).resolves.toBeUndefined();
  });
});
