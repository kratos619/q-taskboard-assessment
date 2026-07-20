import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { createCommentSchema } from "@/schemas/comment";
import { logActivity } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

// Comments are an append-only audit trail: only GET (read) and POST (append)
// are exposed — no PATCH/DELETE, so posted comments can't be edited or removed.

export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: taskId } = await params;
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return notFound("task not found");

  // any project member (including viewers) may read
  const membership = await getProjectMembership(user.id, task.projectId);
  if (!membership) return forbidden("you are not a member of this project");

  const comments = await prisma.comment.findMany({
    where: { taskId },
    include: { author: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ comments });
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: taskId } = await params;

  const raw = await req.json().catch(() => null);
  const parsed = createCommentSchema.safeParse(raw);
  if (!parsed.success) return badRequest("invalid input", parsed.error.flatten());

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return notFound("task not found");

  const membership = await getProjectMembership(user.id, task.projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot post comments");
  }

  const comment = await prisma.comment.create({
    data: { taskId, authorId: user.id, body: parsed.data.body },
    include: { author: { select: { id: true, name: true, email: true } } },
  });

  await logActivity({
    projectId: task.projectId,
    actorId: user.id,
    action: "comment_added",
    taskId,
    detail: parsed.data.body.slice(0, 80),
  });

  return NextResponse.json({ comment }, { status: 201 });
}
