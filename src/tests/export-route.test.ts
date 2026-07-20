import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/jwt";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    membership: { findUnique: vi.fn() },
    task: { findMany: vi.fn() },
  },
}));

// Stand in for the real Airtable client so the route never hits the network.
const fakeStore: { id: string; fields: any }[] = [];
vi.mock("@/lib/airtable", () => ({
  airtableClientFromEnv: () => ({
    list: async () => fakeStore,
    create: async (fields: any) => {
      const rec = { id: `rec${fakeStore.length + 1}`, fields };
      fakeStore.push(rec);
      return { id: rec.id };
    },
    update: async (id: string, fields: any) => ({ id }),
  }),
}));

import { prisma } from "@/lib/prisma";
import { POST as exportPOST } from "@/app/api/projects/[id]/export/route";

const p = prisma as unknown as {
  user: { findUnique: any };
  membership: { findUnique: any };
  task: { findMany: any };
};

const USER = { id: "u1", email: "a@b.com", name: "Ann" };
const TOKEN = signToken({ userId: USER.id, email: USER.email });

function req() {
  return new NextRequest("http://localhost/api/projects/p1/export", {
    method: "POST",
    headers: new Headers({ authorization: `Bearer ${TOKEN}` }),
  });
}
const params = { params: Promise.resolve({ id: "p1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  fakeStore.length = 0;
  p.user.findUnique.mockResolvedValue(USER);
});

describe("POST /api/projects/[id]/export", () => {
  it("forbids a viewer from triggering an export", async () => {
    p.membership.findUnique.mockResolvedValue({ role: "viewer" });

    const res = await exportPOST(req(), params);

    expect(res.status).toBe(403);
    expect(p.task.findMany).not.toHaveBeenCalled();
  });

  it("lets a member export all project tasks and returns a summary", async () => {
    p.membership.findUnique.mockResolvedValue({ role: "member" });
    p.task.findMany.mockResolvedValue([
      { id: "t1", title: "A", description: "d", status: "todo", position: 0, createdAt: "2026-01-01T00:00:00.000Z", assignee: { email: "x@y.com" } },
      { id: "t2", title: "B", description: null, status: "done", position: 1, createdAt: "2026-01-01T00:00:00.000Z", assignee: null },
    ]);

    const res = await exportPOST(req(), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.summary.total).toBe(2);
    expect(body.summary.created).toBe(2);
    expect(fakeStore).toHaveLength(2);
    expect(fakeStore[0].fields.TaskId).toBe("t1");
  });
});
