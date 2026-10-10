import { mkdir } from "node:fs/promises";
import type {
  Approval,
  Artifact,
  Task,
  Step,
  ToolRequest,
  ToolResult,
  Skill,
  ProviderName,
} from "../shared/types.js";
import { Store, id, now } from "./store.js";
import { digest } from "./security.js";
import { projectRoot } from "./files.js";
import { ProviderError, type Provider } from "./providers.js";
import type { ToolBroker } from "./tools.js";
export type EngineTask = Task & {
  recipe?: ToolRequest[];
  skillTestId?: string;
  skillTestVersion?: number;
};
export class Engine {
  active?: { id: string; controller: AbortController };
  listeners = new Set<() => void>();
  closing = false;
  private settled?: Promise<void>;
  private settle?: () => void;
  constructor(
    public store: Store,
    public broker: ToolBroker,
    public provider: Provider,
  ) {
    for (const task of store.list<Task>("task"))
      if (task.status === "running") {
        task.status = "paused";
        task.error =
          "Shadow restarted during execution. Review and resume this task.";
        store.put("task", task);
      }
    for (const step of store.list<Step>("step"))
      if (step.status === "running") {
        step.status = "uncertain";
        delete step.approvalId;
        store.put("step", step);
      }
  }
  changed() {
    for (const fn of this.listeners) fn();
  }
  log(message: string, type = "info", taskId?: string) {
    this.store.activity(message, type, taskId);
    this.changed();
  }
  save(task: Task) {
    task.updatedAt = now();
    this.store.put("task", task);
    this.changed();
  }
  async create(
    prompt: string,
    options: {
      provider?: ProviderName;
      recipe?: ToolRequest[];
      skillTestId?: string;
      defer?: boolean;
    } = {},
  ) {
    const s = this.store.settings();
    const task: EngineTask = {
      id: id(),
      title: prompt.replace(/\s+/g, " ").slice(0, 76),
      prompt,
      status: options.defer ? "paused" : "queued",
      createdAt: now(),
      updatedAt: now(),
      messages: [{ role: "user", content: prompt, at: now() }],
      provider: options.provider || s.provider,
      model: s.plannerModel,
      steps: 0,
      ...(options.recipe
        ? {
            recipe: options.recipe,
            skillTestId: options.skillTestId,
            skillTestVersion: options.skillTestId
              ? this.store.get<Skill>("skill", options.skillTestId)?.version
              : undefined,
          }
        : {}),
    };
    await mkdir(projectRoot(this.store, task.id), { recursive: true });
    this.save(task);
    this.log("Task added to your workspace.", "created", task.id);
    if (!options.defer) void this.pump();
    return task;
  }
  control(taskId: string, action: "pause" | "cancel" | "resume" | "retry") {
    const task = this.store.get<Task>("task", taskId);
    if (!task) throw new Error("Task not found.");
    if (action === "pause" || action === "cancel") {
      if (["completed", "cancelled"].includes(task.status))
        throw new Error("This task has already ended.");
      task.status = action === "pause" ? "paused" : "cancelled";
      this.active?.id === taskId && this.active.controller.abort();
      if (action === "cancel")
        for (const a of this.store
          .list<Approval>("approval")
          .filter((a) => a.taskId === taskId && a.status === "pending"))
          this.store.put("approval", {
            ...a,
            status: "denied",
            decidedAt: now(),
          });
    } else {
      if (
        [
          "running",
          "queued",
          "completed",
          "cancelled",
          "waiting_input",
        ].includes(task.status)
      )
        throw new Error("This task cannot be resumed in its current state.");
      task.status = "queued";
      task.error = undefined;
    }
    this.save(task);
    this.log(
      `Task ${action === "retry" ? "resumed" : action === "resume" ? "resumed" : action === "cancel" ? "cancelled" : "paused"}.`,
      "control",
      taskId,
    );
    void this.pump();
    return task;
  }
  reply(taskId: string, message: string) {
    const task = this.store.get<EngineTask>("task", taskId);
    if (
      !task ||
      !["waiting_input", "paused", "failed", "completed"].includes(task.status)
    )
      throw new Error("Pause this task before adding a follow-up.");
    if (task.status === "completed") {
      task.turn = (task.turn || 0) + 1;
      task.turnStartStep = task.steps;
      delete task.recipe;
      delete task.skillTestId;
      delete task.skillTestVersion;
    }
    task.messages.push({ role: "user", content: message, at: now() });
    task.status = "queued";
    task.error = undefined;
    task.result = undefined;
    this.save(task);
    void this.pump();
    return task;
  }
  decideApproval(approvalId: string, approve: boolean) {
    const a = this.store.get<Approval>("approval", approvalId);
    if (!a || a.status !== "pending")
      throw new Error("Approval is no longer pending.");
    const task = this.store.get<Task>("task", a.taskId);
    if (!task || ["completed", "cancelled"].includes(task.status))
      throw new Error("Task is no longer active.");
    a.status = approve ? "approved" : "denied";
    a.decidedAt = now();
    this.store.put("approval", a);
    if (task.status === "waiting_approval") {
      task.status = "queued";
      this.save(task);
    }
    this.log(
      approve ? "Action approved." : "Action denied.",
      "approval",
      task.id,
    );
    void this.pump();
    return a;
  }
  private requireApproval(task: Task, step: Step, reason: string) {
    let a =
      step.approvalId && this.store.get<Approval>("approval", step.approvalId);
    if (!a) {
      a = {
        id: id(),
        taskId: task.id,
        stepId: step.id,
        request: step.request,
        reason,
        status: "pending",
        createdAt: now(),
      };
      step.approvalId = a.id;
      this.store.put("approval", a);
      this.store.put("step", step);
    }
    return a;
  }
  async pump() {
    if (this.active || this.closing) return;
    const task = this.store
      .list<Task>("task")
      .filter((t) => t.status === "queued")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!task) return;
    const controller = new AbortController();
    this.active = { id: task.id, controller };
    this.settled = new Promise((resolve) => {
      this.settle = resolve;
    });
    task.status = "running";
    this.save(task);
    try {
      await this.run(task.id, controller.signal);
    } catch (e) {
      const current = this.store.get<Task>("task", task.id)!;
      if (current.status === "running") {
        current.status =
          e instanceof ProviderError &&
          ["quota", "auth", "configuration"].includes(e.kind)
            ? "paused"
            : "failed";
        current.error = (e as Error).message;
        this.save(current);
        this.log(current.error, "error", task.id);
      }
    } finally {
      this.active = undefined;
      this.settle?.();
      this.changed();
      if (!this.closing) queueMicrotask(() => void this.pump());
    }
  }
  async run(taskId: string, signal: AbortSignal) {
    let reviewing = false;
    while (!signal.aborted) {
      let task = this.store.get<EngineTask>("task", taskId)!;
      if (task.status !== "running") return;
      if (
        task.steps - (task.turnStartStep || 0) >=
        this.store.settings().maxSteps
      ) {
        task.status = "paused";
        task.error =
          "Step limit reached. Review progress before resuming with a higher limit.";
        this.save(task);
        return;
      }
      let step = this.store
        .list<Step>("step")
        .find(
          (s) =>
            s.taskId === taskId &&
            s.index === task.steps &&
            s.status !== "completed",
        );
      if (!step) {
        const recipe = task.recipe;
        if (!recipe)
          this.log(
            reviewing
              ? "Reviewing outputs against tool evidence."
              : "Planning the next step.",
            "model",
            taskId,
          );
        const action = recipe
          ? task.steps < recipe.length
            ? { kind: "tool" as const, ...recipe[task.steps] }
            : {
                kind: "done" as const,
                message:
                  "Recipe test completed. Every tool returned a successful result.",
              }
          : await this.provider.decide(
              task,
              signal,
              reviewing
                ? "Review the proposed completion against actual tool results. Finish only if the deliverables exist; otherwise request the next needed tool."
                : undefined,
            );
        if (
          signal.aborted ||
          this.store.get<Task>("task", taskId)?.status !== "running"
        )
          return;
        if (action.kind === "ask") {
          task = this.store.get<EngineTask>("task", taskId)!;
          task.status = "waiting_input";
          task.messages.push({
            role: "assistant",
            content: action.message,
            at: now(),
          });
          this.save(task);
          this.log("Waiting for your reply.", "waiting", taskId);
          return;
        }
        if (action.kind === "done") {
          if (!recipe && !reviewing && task.steps > 0) {
            task.messages.push({
              role: "assistant",
              content: "Completion draft for review: " + action.message,
              at: now(),
            });
            this.save(task);
            reviewing = true;
            continue;
          }
          task = this.store.get<EngineTask>("task", taskId)!;
          task.status = "completed";
          task.result = action.message;
          task.messages.push({
            role: "assistant",
            content: action.message,
            at: now(),
          });
          this.save(task);
          if (task.skillTestId) {
            const skill = this.store.get<Skill>("skill", task.skillTestId);
            if (skill && skill.version === task.skillTestVersion) {
              skill.status = "tested";
              skill.enabled = true;
              this.store.put("skill", skill);
            }
          }
          if (!recipe) this.learn(task);
          this.log(
            "Task complete. Outputs are ready to review.",
            "completed",
            taskId,
          );
          return;
        }
        let prepared;
        try {
          prepared = await this.broker.prepare(action, { taskId, signal });
        } catch (e) {
          if (task.recipe)
            throw new Error(
              "Skill test failed validation: " + (e as Error).message,
            );
          task.messages.push({
            role: "tool",
            content: JSON.stringify({
              tool: action.tool,
              ok: false,
              error: (e as Error).message,
            }),
            at: now(),
          });
          task.steps++;
          this.save(task);
          this.log((e as Error).message, "tool_error", taskId);
          continue;
        }
        task = this.store.get<EngineTask>("task", taskId)!;
        if (signal.aborted || task.status !== "running") return;
        step = {
          id: id(),
          taskId,
          index: task.steps,
          request: prepared.request,
          fingerprint: digest(
            stableJson({
              turn: task.turn || 0,
              tool: prepared.request.tool,
              args: prepared.request.args,
            }),
          ),
          status: "pending",
          startedAt: now(),
        };
        this.store.put("step", step);
        task.next = step.request;
        this.save(task);
      }
      const review = this.broker.tools[step.request.tool]?.review;
      const duplicate =
        review &&
        this.store
          .list<Step>("step")
          .find(
            (s) =>
              s.taskId === taskId &&
              s.id !== step!.id &&
              s.status === "completed" &&
              s.fingerprint === step!.fingerprint &&
              (s.result?.ok ||
                JSON.stringify(s.result).includes("owner denied")),
          );
      if (duplicate) {
        this.finishStep(step, {
          ok: !!duplicate.result?.ok,
          output: {
            reused: true,
            message:
              "Identical reviewed action already resolved; it was not repeated.",
            priorResult: duplicate.result,
          },
        });
        continue;
      }
      if (review || step.status === "uncertain") {
        const approval = this.requireApproval(
          task,
          step,
          step.status === "uncertain"
            ? "Execution was interrupted and may already have taken effect. Approve only if you want to run this exact action again."
            : review!,
        );
        if (approval.status === "pending") {
          task.status = "waiting_approval";
          this.save(task);
          this.log("An action needs your review.", "approval", taskId);
          return;
        }
        if (approval.status === "denied") {
          this.finishStep(step, {
            ok: false,
            output: {
              error:
                "The owner denied this action. Do not bypass or repeat it.",
            },
          });
          if (task.recipe)
            throw new Error("Skill test stopped because an action was denied.");
          continue;
        }
      }
      if (signal.aborted) return;
      step.status = "running";
      this.store.put("step", step);
      this.log(
        step.request.summary || `Using ${step.request.tool}`,
        "tool",
        taskId,
      );
      let result: ToolResult;
      try {
        result = await this.broker.execute(step.request, { taskId, signal });
      } catch (e) {
        if (signal.aborted) {
          step.status = "uncertain";
          delete step.approvalId;
          this.store.put("step", step);
          return;
        }
        result = { ok: false, output: { error: (e as Error).message } };
      }
      this.finishStep(step, result);
      reviewing = false;
      if (task.recipe && !result.ok)
        throw new Error("Skill test failed: " + JSON.stringify(result.output));
    }
  }
  private finishStep(step: Step, result: ToolResult) {
    step.status = "completed";
    step.result = result;
    step.endedAt = now();
    this.store.put("step", step);
    const task = this.store.get<Task>("task", step.taskId)!;
    task.steps = Math.max(task.steps, step.index + 1);
    delete task.next;
    task.messages.push({
      role: "tool",
      content: JSON.stringify({
        tool: step.request.tool,
        request: step.request.args,
        ...result,
      }).slice(0, 26000),
      at: now(),
    });
    this.save(task);
    this.log(
      result.ok
        ? "Tool result verified."
        : "Tool returned an error. Inspecting alternatives.",
      result.ok ? "tool_result" : "tool_error",
      task.id,
    );
  }
  private learn(task: Task) {
    const steps = this.store
      .list<Step>("step")
      .filter(
        (s) =>
          s.taskId === task.id &&
          s.status === "completed" &&
          s.result?.ok &&
          !this.broker.tools[s.request.tool]?.review &&
          s.request.tool !== "skill.propose" &&
          s.request.tool !== "memory.save",
      )
      .sort((a, b) => a.index - b.index);
    if (steps.length < 2) return;
    const name = `Learned: ${task.title.slice(0, 60)}`;
    if (this.store.list<Skill>("skill").some((s) => s.name === name)) return;
    const skill: Skill = {
      id: id(),
      name,
      description:
        "Saved from a successful task. Review its example arguments before reuse.",
      triggers: task.prompt
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 5)
        .slice(0, 5),
      instructions:
        "Adapt this successful sequence to the new user request. Inspect current inputs and do not blindly replay old topic-specific arguments. Tools used: " +
        steps.map((s) => s.request.tool).join(" → "),
      recipe: steps.map((s) => s.request),
      version: 1,
      enabled: false,
      status: "tested",
      history: [],
      createdAt: now(),
    };
    this.store.put("skill", skill);
  }
  async close() {
    this.closing = true;
    if (this.active) {
      const task = this.store.get<Task>("task", this.active.id);
      if (task?.status === "running") {
        task.status = "paused";
        task.error =
          "Shadow stopped. Review and resume this task when it starts again.";
        this.save(task);
      }
      this.active.controller.abort();
      await this.settled;
    }
    await this.broker.browser.close();
  }
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) +
            ":" +
            stableJson((value as Record<string, unknown>)[key]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
}
