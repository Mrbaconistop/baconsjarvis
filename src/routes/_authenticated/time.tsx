import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader, PriorityChip } from "@/components/jarvis/HudBits";
import {
  listReminders,
  createReminder,
  toggleReminder,
  deleteReminder,
  getTasksByStatus,
  updateTaskStatus,
  createTask,
} from "@/lib/reminders.functions";
import { formatRelative, formatClock, formatDateLong, minutesUntil } from "@/lib/time-utils";
import { Check, Plus, Trash2, Calendar, LayoutList, LayoutBoard, ArrowLeft, ArrowRight, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/time")({
  head: () => ({
    meta: [{ title: "Time — JARVIS" }, { name: "description", content: "Reminders and calendar agenda." }],
  }),
  component: TimePage,
});

type Task = {
  id: string;
  title: string;
  description: string | null;
  datetime: string;
  priority: "critical" | "high" | "normal" | "low";
  recurrence: string | null;
  status: "todo" | "doing" | "done";
  order: number;
  is_completed: boolean;
};

const COLUMNS = {
  todo: { label: "To Do", color: "bg-arc/10 border-arc/30" },
  doing: { label: "Doing", color: "bg-warning/10 border-warning/30" },
  done: { label: "Done", color: "bg-success/10 border-success/30" },
} as const;

function TimePage() {
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "board">("list");

  const list = useServerFn(listReminders);
  const create = useServerFn(createReminder);
  const toggle = useServerFn(toggleReminder);
  const del = useServerFn(deleteReminder);
  const getTasks = useServerFn(getTasksByStatus);
  const updateStatus = useServerFn(updateTaskStatus);
  const createTaskFn = useServerFn(createTask);

  const { data: reminders, isLoading: listLoading } = useQuery({
    queryKey: ["reminders"],
    queryFn: () => list(),
    enabled: view === "list",
  });

  const { data: tasks, isLoading: boardLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => getTasks(),
    enabled: view === "board",
  });

  const [title, setTitle] = useState("");
  const [datetime, setDatetime] = useState("");
  const [priority, setPriority] = useState<"critical" | "high" | "normal" | "low">("normal");
  const [recurrence, setRecurrence] = useState<"" | "daily" | "weekdays" | "weekly" | "monthly">("");

  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    datetime: "",
    priority: "normal" as Task["priority"],
    status: "todo" as Task["status"],
  });

  async function addReminder() {
    if (!title.trim() || !datetime) return;
    try {
      await create({
        data: {
          title,
          datetime: new Date(datetime).toISOString(),
          priority,
          recurrence: recurrence || null,
        },
      });
      qc.invalidateQueries({ queryKey: ["reminders"] });
      setTitle("");
      setDatetime("");
      setPriority("normal");
      setRecurrence("");
      toast.success("Logged, Sir.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  }

  async function moveTask(task: Task, direction: "left" | "right") {
    const statuses: Task["status"][] = ["todo", "doing", "done"];
    const currentIndex = statuses.indexOf(task.status);
    let newIndex = currentIndex + (direction === "right" ? 1 : -1);
    if (newIndex < 0 || newIndex >= statuses.length) return;
    const newStatus = statuses[newIndex];
    try {
      await updateStatus({ data: { id: task.id, status: newStatus } });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(`Moved to ${COLUMNS[newStatus].label}`);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function deleteTaskHandler(id: string) {
    if (!confirm("Delete this task?")) return;
    try {
      await del({ data: { id } });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task deleted.");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createTaskFn({ data: { ...newTask, datetime: newTask.datetime || undefined } });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      setShowCreate(false);
      setNewTask({ title: "", description: "", datetime: "", priority: "normal", status: "todo" });
      toast.success("Task created.");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const isLoading = view === "list" ? listLoading : boardLoading;

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        tag="01 · TIME"
        title="Schedule & Tasks"
        subtitle="Manage your time – list view or Kanban board."
        right={
          <div className="flex gap-2">
            <button
              onClick={() => setView("list")}
              className={`text-xs px-3 py-1.5 rounded-md border transition ${
                view === "list" ? "bg-arc text-arc-foreground border-arc" : "border-arc/30 hover:bg-arc/10"
              }`}
            >
              <LayoutList size={14} className="inline mr-1" /> List
            </button>
            <button
              onClick={() => setView("board")}
              className={`text-xs px-3 py-1.5 rounded-md border transition ${
                view === "board" ? "bg-arc text-arc-foreground border-arc" : "border-arc/30 hover:bg-arc/10"
              }`}
            >
              <LayoutBoard size={14} className="inline mr-1" /> Board
            </button>
            {view === "board" && (
              <button
                onClick={() => setShowCreate(true)}
                className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-arc text-arc-foreground shadow-arc hover:opacity-90 transition"
              >
                <Plus size={12} /> Add Task
              </button>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {view === "list" ? (
          <>
            <div className="glass-strong hud-corners rounded-xl p-5">
              <div className="font-mono text-[10px] tracking-[0.3em] text-arc mb-3 flex items-center gap-2">
                <Plus size={12} /> NEW REMINDER
              </div>
              <div className="grid md:grid-cols-[1fr_220px_140px_140px_auto] gap-3">
                <input
                  placeholder="e.g. Coffee with Marina"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
                />
                <input
                  type="datetime-local"
                  value={datetime}
                  onChange={(e) => setDatetime(e.target.value)}
                  className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm font-mono focus:border-arc focus:outline-none"
                />
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
                <select
                  value={recurrence}
                  onChange={(e) => setRecurrence(e.target.value as any)}
                  className="bg-background/40 border border-arc/20 rounded-md px-3 py-2 text-sm focus:border-arc focus:outline-none"
                >
                  <option value="">One-off</option>
                  <option value="daily">Daily</option>
                  <option value="weekdays">Weekdays</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                <button
                  onClick={addReminder}
                  className="bg-arc text-arc-foreground rounded-md px-4 text-sm font-medium shadow-arc hover:opacity-90 transition"
                >
                  Add
                </button>
              </div>
              <p className="mt-2 text-xs text-hud-dim">
                Tip: tell JARVIS in chat — "remind me every weekday at 8am to stretch" — and it will set it for you.
              </p>
            </div>

            {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}

            <section>
              <h2 className="font-display text-lg mb-3 flex items-center gap-2">
                <Calendar size={16} className="text-arc" /> Upcoming
              </h2>
              <div className="space-y-2">
                {reminders?.length === 0 && (
                  <div className="glass rounded-lg p-4 text-sm text-muted-foreground">Clear horizon, Sir.</div>
                )}
                {reminders?.map((r: any) => {
                  const mins = minutesUntil(r.datetime);
                  const imminent = mins > 0 && mins <= 30;
                  return (
                    <article
                      key={r.id}
                      className={`${r.priority === "critical" ? "glass-critical" : "glass-strong"} rounded-lg p-4 flex items-start gap-4`}
                    >
                      <button
                        onClick={async () => {
                          await toggle({ data: { id: r.id, completed: true } });
                          qc.invalidateQueries({ queryKey: ["reminders"] });
                        }}
                        className="mt-1 h-5 w-5 rounded border border-arc/40 hover:bg-arc/20 flex items-center justify-center transition"
                        aria-label="Complete"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-medium">{r.title}</h3>
                          <PriorityChip level={r.priority} />
                          {r.recurrence && (
                            <span className="text-[10px] font-mono text-arc bg-arc/10 border border-arc/20 px-1.5 py-0.5 rounded uppercase">
                              {r.recurrence}
                            </span>
                          )}
                          {imminent && (
                            <span className="text-[10px] font-mono text-critical animate-critical-pulse">IMMINENT</span>
                          )}
                        </div>
                        {r.description && <p className="text-sm text-muted-foreground mt-1">{r.description}</p>}
                        <div className="mt-1.5 font-mono text-xs text-arc">
                          {formatDateLong(r.datetime)} · {formatClock(r.datetime)}
                          <span className="text-hud-dim"> · {formatRelative(r.datetime)}</span>
                          {r.source_type && <span className="text-hud-dim"> · from {r.source_type}</span>}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          await del({ data: { id: r.id } });
                          qc.invalidateQueries({ queryKey: ["reminders"] });
                        }}
                        className="text-hud-dim hover:text-critical transition p-1"
                        aria-label="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          <>
            {isLoading && <div className="text-sm text-muted-foreground">Loading tasks…</div>}
            {tasks && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(["todo", "doing", "done"] as const).map((statusKey) => {
                  const columnTasks = (tasks?.[statusKey] || []) as Task[];
                  const col = COLUMNS[statusKey];

                  return (
                    <div key={statusKey} className={`rounded-xl border ${col.color} p-4 flex flex-col min-h-[300px]`}>
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="font-display text-sm font-medium">{col.label}</h2>
                        <span className="font-mono text-xs text-hud-dim">{columnTasks.length}</span>
                      </div>
                      <div className="flex-1 space-y-2">
                        {columnTasks.length === 0 && (
                          <div className="text-xs text-hud-dim p-4 text-center">No tasks here yet.</div>
                        )}
                        {columnTasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            onMoveLeft={() => moveTask(task, "left")}
                            onMoveRight={() => moveTask(task, "right")}
                            onDelete={() => deleteTaskHandler(task.id)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Task Modal (Board view) */}
      {showCreate && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-center justify-center p-6"
          onClick={() => setShowCreate(false)}
        >
          <div className="glass-strong hud-corners rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display">New Task</h2>
              <button onClick={() => setShowCreate(false)} className="text-hud-dim hover:text-foreground">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCreateTask} className="space-y-4">
              <div>
                <label className="block font-mono text-[10px] text-hud-dim mb-1">Title *</label>
                <input
                  type="text"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  required
                  className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] text-hud-dim mb-1">Description</label>
                <input
                  type="text"
                  value={newTask.description}
                  onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] text-hud-dim mb-1">Due Date</label>
                <input
                  type="datetime-local"
                  value={newTask.datetime}
                  onChange={(e) => setNewTask({ ...newTask, datetime: e.target.value })}
                  className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] text-hud-dim mb-1">Priority</label>
                <select
                  value={newTask.priority}
                  onChange={(e) => setNewTask({ ...newTask, priority: e.target.value as Task["priority"] })}
                  className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label className="block font-mono text-[10px] text-hud-dim mb-1">Status</label>
                <select
                  value={newTask.status}
                  onChange={(e) => setNewTask({ ...newTask, status: e.target.value as Task["status"] })}
                  className="w-full bg-background/60 border border-arc/20 rounded-md px-3 py-2 text-sm"
                >
                  <option value="todo">To Do</option>
                  <option value="doing">Doing</option>
                  <option value="done">Done</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full bg-arc text-arc-foreground py-2 rounded-md shadow-arc hover:opacity-90 transition"
              >
                Create Task
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  onMoveLeft,
  onMoveRight,
  onDelete,
}: {
  task: Task;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onDelete: () => void;
}) {
  const isFirst = task.status === "todo";
  const isLast = task.status === "done";

  return (
    <div className="bg-background/60 border border-arc/15 rounded-lg p-3 hover:border-arc/30 transition">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{task.title}</span>
            <PriorityChip level={task.priority} />
          </div>
          {task.description && <p className="text-xs text-muted-foreground mt-1 truncate">{task.description}</p>}
          <div className="mt-1.5 flex items-center gap-3 text-[10px] font-mono text-hud-dim">
            <span className="flex items-center gap-1">
              <Calendar size={10} /> {formatDateLong(task.datetime)} at {formatClock(task.datetime)}
            </span>
            {task.recurrence && <span className="text-arc">↻ {task.recurrence}</span>}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          {!isFirst && (
            <button
              onClick={onMoveLeft}
              className="p-1 rounded hover:bg-arc/10 text-hud-dim hover:text-arc transition"
              title="Move left"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          {!isLast && (
            <button
              onClick={onMoveRight}
              className="p-1 rounded hover:bg-arc/10 text-hud-dim hover:text-arc transition"
              title="Move right"
            >
              <ArrowRight size={14} />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1 rounded hover:bg-critical/10 text-hud-dim hover:text-critical transition"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
