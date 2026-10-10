export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "waiting_input"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";
export type ProviderName = "agy" | "gemini" | "groq" | "openrouter";
export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  at: string;
}
export interface Task {
  id: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
  provider: ProviderName;
  model: string;
  steps: number;
  turn?: number;
  turnStartStep?: number;
  error?: string;
  next?: ToolRequest;
  result?: string;
}
export interface ToolRequest {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}
export interface ToolResult {
  ok: boolean;
  output: unknown;
  artifacts?: string[];
}
export interface Step {
  id: string;
  taskId: string;
  index: number;
  request: ToolRequest;
  fingerprint: string;
  status: "pending" | "running" | "completed" | "uncertain";
  result?: ToolResult;
  approvalId?: string;
  startedAt: string;
  endedAt?: string;
}
export interface Approval {
  id: string;
  taskId: string;
  stepId: string;
  reason: string;
  request: ToolRequest;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  decidedAt?: string;
}
export interface Memory {
  id: string;
  text: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}
export interface Skill {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  instructions: string;
  version: number;
  enabled: boolean;
  status: "draft" | "tested";
  recipe: ToolRequest[];
  history: {
    version: number;
    instructions: string;
    recipe: ToolRequest[];
    at: string;
  }[];
  createdAt: string;
}
export interface Artifact {
  id: string;
  taskId: string;
  name: string;
  relativePath: string;
  mime: string;
  size: number;
  createdAt: string;
}
export interface Activity {
  id: string;
  taskId?: string;
  type: string;
  message: string;
  at: string;
}
export interface CommandRegistration {
  id: string;
  name: string;
  executable: string;
  args: string[];
  cwd: string;
  expectedOutputs: string[];
  description: string;
}
export interface Settings {
  initiative: "ask" | "recommend" | "decide";
  companionEnabled: boolean;
  companionVoice: boolean;
  provider: ProviderName;
  plannerModel: string;
  workerModel: string;
  maxSteps: number;
  maxDailyCalls: number;
  publicUrl: string;
  agyPath: string;
  browserChannel: "chrome" | "msedge";
  apiModels: Record<"gemini" | "groq" | "openrouter", string>;
  freeAllowanceConfirmed: Record<"gemini" | "groq" | "openrouter", boolean>;
}
export interface Connection {
  id: string;
  name: string;
  category: string;
  status: "ready" | "unconfigured" | "needs_login" | "error";
  detail: string;
}
export interface Snapshot {
  plans: TaskPlan[];
  tasks: Task[];
  approvals: Approval[];
  memories: Memory[];
  skills: Skill[];
  artifacts: Artifact[];
  activity: Activity[];
  commands: CommandRegistration[];
  settings: Settings;
  connections: Connection[];
}
export interface TaskPlan {
  id: string;
  goal: string;
  assumptions: string[];
  decisions: string[];
  stages: { title: string; status: "pending" | "active" | "completed" | "blocked"; evidence: string; artifactIds: string[] }[];
  updatedAt: string;
}
export type AgentDecision =
  | {
      kind: "tool";
      tool: string;
      args: Record<string, unknown>;
      summary: string;
    }
  | { kind: "done"; message: string }
  | { kind: "ask"; message: string };
