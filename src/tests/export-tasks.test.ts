import { describe, it, expect, beforeEach } from "vitest";
import { AirtableMockClient } from "@/lib/airtable-mock";
import { exportTasks, taskToFields, type ExportableTask, type TaskRecordClient } from "@/lib/export-tasks";

// Adapt the provided mock (create takes { fields }) to our {list,create,update} client.
function mockAdapter(mock: AirtableMockClient): TaskRecordClient {
  return {
    list: async () => (await mock.list()).map((r) => ({ id: r.id, fields: r.fields })),
    create: async (fields) => mock.create({ fields }),
    update: async (id, fields) => mock.update(id, fields),
  };
}

function task(id: string, over: Partial<ExportableTask> = {}): ExportableTask {
  return {
    id,
    title: `Task ${id}`,
    description: "d",
    status: "todo",
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    assignee: null,
    ...over,
  };
}

const NO_DELAY = { retries: 3, delayMs: 0 };

describe("exportTasks", () => {
  let mock: AirtableMockClient;
  let client: TaskRecordClient;

  beforeEach(() => {
    mock = new AirtableMockClient();
    client = mockAdapter(mock);
  });

  it("creates one Airtable record per task", async () => {
    const tasks = [task("t1"), task("t2"), task("t3")];
    const summary = await exportTasks(tasks, client, NO_DELAY);

    expect(summary.created).toBe(3);
    expect(summary.updated).toBe(0);
    expect(summary.failed).toEqual([]);
    expect(mock.__getRecordCount()).toBe(3);
    // task identity is written so re-runs can match
    expect(mock.__getRecords()[0].fields.TaskId).toBe("t1");
  });

  it("is idempotent: a second run updates in place, no duplicates", async () => {
    const tasks = [task("t1"), task("t2")];
    await exportTasks(tasks, client, NO_DELAY);

    const second = await exportTasks(
      [task("t1", { title: "renamed" }), task("t2")],
      client,
      NO_DELAY
    );

    expect(mock.__getRecordCount()).toBe(2); // still 2, not 4
    expect(second.created).toBe(0);
    expect(second.updated).toBe(2);
    const t1 = mock.__getRecords().find((r) => r.fields.TaskId === "t1");
    expect(t1?.fields.Title).toBe("renamed");
  });

  it("retries a transient failure and eventually succeeds", async () => {
    let attempts = 0;
    const flaky: TaskRecordClient = {
      list: async () => [],
      create: async (fields) => {
        attempts++;
        if (attempts < 3) {
          const e: any = new Error("rate limited");
          e.statusCode = 429;
          throw e;
        }
        return { id: "rec1", fields };
      },
      update: async (id, fields) => ({ id, fields }),
    };

    const summary = await exportTasks([task("t1")], flaky, NO_DELAY);

    expect(attempts).toBe(3);
    expect(summary.created).toBe(1);
    expect(summary.failed).toEqual([]);
  });

  it("does not retry a permanent failure and still exports the other tasks", async () => {
    let t1Attempts = 0;
    const partial: TaskRecordClient = {
      list: async () => [],
      create: async (fields) => {
        if (fields.TaskId === "t1") {
          t1Attempts++;
          const e: any = new Error("unknown field");
          e.statusCode = 422;
          throw e;
        }
        return { id: "rec2", fields };
      },
      update: async (id, fields) => ({ id, fields }),
    };

    const summary = await exportTasks([task("t1"), task("t2")], partial, NO_DELAY);

    expect(t1Attempts).toBe(1); // permanent -> tried once, no retry
    expect(summary.created).toBe(1); // t2 still exported
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].taskId).toBe("t1");
  });
});

describe("taskToFields", () => {
  it("maps assignee to its email and includes the task id", () => {
    const fields = taskToFields(
      task("t9", { title: "Ship it", assignee: { email: "a@b.com" } })
    );
    expect(fields.TaskId).toBe("t9");
    expect(fields.Title).toBe("Ship it");
    expect(fields.Assignee).toBe("a@b.com");
  });
});
