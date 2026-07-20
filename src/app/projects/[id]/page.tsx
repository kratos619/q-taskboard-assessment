"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getToken, getStoredUser } from "@/lib/api-client";
import { Header } from "@/components/Header";
import { StatusColumn } from "@/components/StatusColumn";
import { TaskDetail } from "@/components/TaskDetail";
import type { ApiProjectDetail, ApiTask, ApiActivity, TaskStatus } from "@/types";
import { STATUS_ORDER } from "@/types";

type PageProps = { params: Promise<{ id: string }> };

export default function ProjectPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const queryClient = useQueryClient();

  const [activeTask, setActiveTask] = useState<ApiTask | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newColumn, setNewColumn] = useState<TaskStatus>("todo");
  const [error, setError] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["project", id],
    queryFn: () => apiFetch<{ project: ApiProjectDetail }>(`/api/projects/${id}`),
  });

  const { data: activityData } = useQuery({
    queryKey: ["activity", id],
    queryFn: () => apiFetch<{ activities: ApiActivity[] }>(`/api/projects/${id}/activity`),
  });
  const activities = activityData?.activities ?? [];

  const ACTION_LABEL: Record<ApiActivity["action"], string> = {
    task_created: "created a task",
    status_changed: "changed status",
    assignee_changed: "changed assignee",
    comment_added: "commented",
  };

  const createTask = useMutation({
    mutationFn: (input: { title: string; status: TaskStatus }) =>
      apiFetch<{ task: ApiTask }>(`/api/projects/${id}/tasks`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      setNewTitle("");
      queryClient.invalidateQueries({ queryKey: ["project", id] });
      queryClient.invalidateQueries({ queryKey: ["activity", id] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "create failed"),
  });

  const exportToAirtable = useMutation({
    mutationFn: () =>
      apiFetch<{ summary: { total: number; created: number; updated: number; failed: unknown[] } }>(
        `/api/projects/${id}/export`,
        { method: "POST" }
      ),
    onMutate: () => setExportMsg(null),
    onSuccess: ({ summary }) =>
      setExportMsg(
        `exported ${summary.total}: ${summary.created} created, ${summary.updated} updated` +
          (summary.failed.length ? `, ${summary.failed.length} failed` : "")
      ),
    onError: (err) => setExportMsg(err instanceof Error ? err.message : "export failed"),
  });

  const project = data?.project;
  const myId = getStoredUser()?.id;
  const myRole = project?.memberships.find((m) => m.user.id === myId)?.role;
  const canExport = myRole === "admin" || myRole === "member";
  const tasksByStatus: Record<TaskStatus, ApiTask[]> = {
    todo: [],
    in_progress: [],
    review: [],
    done: [],
  };
  if (project) {
    for (const t of project.tasks) {
      tasksByStatus[t.status].push(t);
    }
  }

  return (
    <div className="min-h-screen">
      <Header />

      <main className="max-w-7xl mx-auto px-6 py-8">
        <Link
          href="/dashboard"
          className="text-sm text-muted hover:text-white"
        >
          ← all projects
        </Link>

        {isLoading && <p className="text-muted text-sm mt-6">loading…</p>}
        {queryError && (
          <p className="text-sm text-red-400 mt-6">
            {queryError instanceof Error ? queryError.message : "failed to load"}
          </p>
        )}

        {project && (
          <>
            <div className="flex items-start justify-between mt-4 mb-8">
              <div>
                <h1 className="text-2xl font-semibold">{project.name}</h1>
                {project.description && (
                  <p className="text-sm text-muted mt-1 max-w-2xl">
                    {project.description}
                  </p>
                )}
                <p className="text-xs text-muted mt-2">
                  owner: {project.owner.name} · {project.memberships.length} members
                </p>
              </div>
              {canExport && (
                <div className="flex flex-col items-end gap-1">
                  <button
                    onClick={() => exportToAirtable.mutate()}
                    disabled={exportToAirtable.isPending}
                    className="bg-surface border border-border hover:border-accent text-sm font-medium rounded-md px-4 py-2 disabled:opacity-50"
                  >
                    {exportToAirtable.isPending ? "exporting…" : "export to Airtable"}
                  </button>
                  {exportMsg && (
                    <p className="text-xs text-muted max-w-xs text-right" role="status">
                      {exportMsg}
                    </p>
                  )}
                </div>
              )}
            </div>

            <section className="bg-surface border border-border rounded-lg p-4 mb-6">
              <h2 className="text-sm font-medium mb-3">add a task</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newTitle.trim()) return;
                  setError(null);
                  createTask.mutate({ title: newTitle.trim(), status: newColumn });
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="task title"
                  className="flex-1 rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
                <select
                  value={newColumn}
                  onChange={(e) => setNewColumn(e.target.value as TaskStatus)}
                  className="rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={createTask.isPending}
                  className="bg-accent hover:bg-indigo-500 text-white text-sm font-medium rounded-md px-4 disabled:opacity-50"
                >
                  add
                </button>
              </form>
              {error && (
                <p className="text-sm text-red-400 mt-2" role="alert">
                  {error}
                </p>
              )}
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {STATUS_ORDER.map((s) => (
                <StatusColumn
                  key={s}
                  status={s}
                  tasks={tasksByStatus[s]}
                  onTaskClick={setActiveTask}
                />
              ))}
            </div>

            <section className="mt-10">
              <h2 className="text-sm font-medium mb-3">recent activity</h2>
              <ul className="bg-surface border border-border rounded-lg divide-y divide-border">
                {activities.length === 0 && (
                  <li className="px-4 py-3 text-xs text-muted">no activity yet</li>
                )}
                {activities.map((a) => (
                  <li key={a.id} className="px-4 py-3 flex items-baseline justify-between gap-3 text-sm">
                    <span>
                      <span className="font-medium">{a.actor.name}</span>{" "}
                      <span className="text-muted">{ACTION_LABEL[a.action]}</span>
                      {a.detail && <span className="text-muted"> — {a.detail}</span>}
                    </span>
                    <span className="text-xs text-muted whitespace-nowrap">
                      {new Date(a.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-10">
              <h2 className="text-sm font-medium mb-3">members</h2>
              <ul className="bg-surface border border-border rounded-lg divide-y divide-border">
                {project.memberships.map((m) => (
                  <li
                    key={m.id}
                    className="px-4 py-3 flex items-center justify-between text-sm"
                  >
                    <span>{m.user.name}</span>
                    <span className="text-xs text-muted">
                      {m.user.email} · {m.role}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>

      {activeTask && project && (
        <TaskDetail
          task={activeTask}
          projectId={id}
          members={project.memberships}
          onClose={() => setActiveTask(null)}
        />
      )}
    </div>
  );
}
