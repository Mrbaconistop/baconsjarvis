import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { PageHeader, PriorityChip } from "@/components/jarvis/HudBits";
import { getTasksByStatus, updateTaskStatus, deleteReminder, createTask } from "@/lib/reminders.functions";
import { formatClock, formatDateLong } from "@/lib/time-utils";
import { Plus, Trash2, ArrowLeft, ArrowRight, Calendar, X, List, LayoutGrid } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/time")({
  head: () => ({ meta: [{ title: "Tasks — JARVIS" }] }),
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
  const getTasks = useServerFn(getTasksByStatus);
  const updateStatus = useServerFn(updateTaskStatus);
  const deleteTask = useServerFn(deleteReminder);
  const createTaskFn = useServerFn(createTask);

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => getTasks(),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    datetime: "",
    priority: "normal" as Task["priority"],
    status: "todo" as Task["status"],
  });

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
      await deleteTask({ data: { id } });
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

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading tasks…</div>;

  return (
    <div className="flex flex-col h-screen">
      <PageHeader
        tag="02 · TASKS"
        title="Kanban Board"
        subtitle="Organise your work – To Do, Doing, Done."
        right={
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-md bg-arc text-arc-foreground shadow-arc hover:opacity-90 transition"
          >
            <Plus size={12} /> Add Task
          </button>
        }
      />

      <div className="flex-1 overflow-x-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-full">
          {(["todo", "doing", "done"] as const).map((statusKey) => {
            const columnTasks = (tasks?.[statusKey] || []) as Task[];
            const col = COLUMNS[statusKey];

            return (
              <div key={statusKey} className={`rounded-xl border ${col.color} p-4 flex flex-col h-full`}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-display text-sm font-medium">{col.label}</h2>
                  <span className="font-mono text-xs text-hud-dim">{columnTasks.length}</span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto">
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
      </div>

      {/* Create Task Modal */}
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
