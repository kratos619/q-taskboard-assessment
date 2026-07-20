import { prisma } from "./prisma";

export type ActivityAction =
  | "task_created"
  | "status_changed"
  | "assignee_changed"
  | "comment_added";

export type ActivityInput = {
  projectId: string;
  actorId: string;
  action: ActivityAction;
  taskId?: string;
  detail?: string;
};

/**
 * Best-effort audit write for the project activity feed. See DESIGN_NOTES.md:
 * the feed is a secondary projection, so a failed write is logged and
 * swallowed — it never fails the user's primary action.
 */
export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    await prisma.activity.create({ data: input });
  } catch (err) {
    console.error("activity write failed (swallowed):", input.action, err);
  }
}
