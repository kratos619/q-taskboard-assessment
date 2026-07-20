import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { airtableClientFromEnv } from "@/lib/airtable";
import { exportTasks, type ExportableTask } from "@/lib/export-tasks";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;
  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("only project admins or members can export");
  }

  const rows = await prisma.task.findMany({
    where: { projectId },
    include: { assignee: { select: { email: true } } },
    orderBy: [{ status: "asc" }, { position: "asc" }],
  });

  const tasks: ExportableTask[] = rows.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    position: t.position,
    createdAt: t.createdAt,
    assignee: t.assignee,
  }));

  let client;
  try {
    client = airtableClientFromEnv();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "airtable not configured" },
      { status: 500 }
    );
  }

  const summary = await exportTasks(tasks, client);
  return NextResponse.json({ summary });
}
