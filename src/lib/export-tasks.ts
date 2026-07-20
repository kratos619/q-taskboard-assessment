/**
 * Idempotent bulk export of TaskBoard tasks to an external record store
 * (Airtable in production; the mock in tests). Keyed on a `TaskId` field so
 * re-running updates existing records instead of duplicating them.
 */

export type ExportableTask = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  position: number;
  createdAt: string | Date;
  assignee?: { email: string } | null;
};

export type AirtableFields = Record<string, unknown>;

export interface TaskRecordClient {
  list(): Promise<{ id: string; fields: AirtableFields }[]>;
  create(fields: AirtableFields): Promise<{ id: string }>;
  update(id: string, fields: AirtableFields): Promise<{ id: string }>;
}

export type ExportSummary = {
  total: number;
  created: number;
  updated: number;
  failed: { taskId: string; error: string }[];
};

export function taskToFields(task: ExportableTask): AirtableFields {
  return {
    TaskId: task.id,
    Title: task.title,
    Description: task.description ?? "",
    Status: task.status,
    Position: task.position,
    Assignee: task.assignee?.email ?? "",
    CreatedAt: new Date(task.createdAt).toISOString(),
  };
}

type RetryOpts = {
  retries?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Transient = worth retrying (rate limit, server error, network). Everything
// else (validation, auth, not-found) is permanent and retrying won't help.
function isTransient(err: unknown): boolean {
  const code = (err as { statusCode?: number })?.statusCode;
  return code === 429 || code === 0 || (typeof code === "number" && code >= 500);
}

async function withRetry<T>(fn: () => Promise<T>, opts: Required<Pick<RetryOpts, "retries" | "delayMs" | "sleep">>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= opts.retries || !isTransient(err)) throw err;
      await opts.sleep(opts.delayMs * (attempt + 1)); // linear backoff
    }
  }
}

export async function exportTasks(
  tasks: ExportableTask[],
  client: TaskRecordClient,
  opts: RetryOpts = {}
): Promise<ExportSummary> {
  const retry = {
    retries: opts.retries ?? 3,
    delayMs: opts.delayMs ?? 300,
    sleep: opts.sleep ?? defaultSleep,
  };

  // Map existing records by TaskId so re-runs update instead of duplicate.
  // Listing is itself retried; if it fails permanently we start from empty
  // (worst case: duplicates, never a crash) — but a create failure below is
  // recorded, not swallowed.
  let existing: { id: string; fields: AirtableFields }[] = [];
  try {
    existing = await withRetry(() => client.list(), retry);
  } catch {
    existing = [];
  }
  const byTaskId = new Map<string, string>();
  for (const rec of existing) {
    const tid = rec.fields?.TaskId;
    if (typeof tid === "string") byTaskId.set(tid, rec.id);
  }

  const summary: ExportSummary = { total: tasks.length, created: 0, updated: 0, failed: [] };

  for (const task of tasks) {
    const fields = taskToFields(task);
    const existingId = byTaskId.get(task.id);
    try {
      if (existingId) {
        await withRetry(() => client.update(existingId, fields), retry);
        summary.updated++;
      } else {
        await withRetry(() => client.create(fields), retry);
        summary.created++;
      }
    } catch (err) {
      // one bad record must not fail the whole export
      summary.failed.push({ taskId: task.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}
