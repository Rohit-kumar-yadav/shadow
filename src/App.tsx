import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Companion } from "./Companion";
import {
  ArrowUp,
  ArrowUpRight,
  ArrowRight,
  Plus,
  PanelLeft,
  Search,
  LayoutDashboard,
  MessageSquare,
  ListTodo,
  FolderOpen,
  BookOpen,
  Brain,
  Plug,
  Settings2,
  ShieldCheck,
  Globe,
  Terminal,
  Video,
  FileText,
  Image as ImageIcon,
  Music,
  Check,
  ChevronRight,
  ChevronDown,
  Pause,
  Play,
  RotateCcw,
  X,
  Download,
  Paperclip,
  LoaderCircle,
  ExternalLink,
  Clock,
  MoreHorizontal,
  Trash2,
  Pencil,
  Copy,
  Smartphone,
  KeyRound,
  Activity,
  Sparkles,
  Code2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import Markdown from "react-markdown";
import type {
  Approval,
  Artifact,
  CommandRegistration,
  Connection,
  Memory,
  Settings,
  Skill,
  Snapshot,
  Task,
  TaskStatus,
} from "../shared/types";
import { api } from "./api";
type View =
  | "overview"
  | "assistant"
  | "tasks"
  | "library"
  | "skills"
  | "memory"
  | "connections"
  | "settings";
const names: Record<View, string> = {
  overview: "Overview",
  assistant: "Assistant",
  tasks: "Tasks",
  library: "Library",
  skills: "Skills",
  memory: "Memory",
  connections: "Connections",
  settings: "Settings",
};
const statuses: Record<TaskStatus, string> = {
  queued: "Queued",
  running: "Working",
  waiting_approval: "Needs review",
  waiting_input: "Needs your input",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};
const nav = [
  ["overview", LayoutDashboard],
  ["assistant", MessageSquare],
  ["tasks", ListTodo],
  ["library", FolderOpen],
  ["skills", BookOpen],
  ["memory", Brain],
] as const;
function Brand() {
  return (
    <span className="brand-symbol" aria-hidden="true">
      <svg viewBox="0 0 32 32">
        <path d="M23 8H14C5 8 5 16 14 16h4c9 0 9 8 0 8H9" />
      </svg>
    </span>
  );
}
function Status({ status }: { status: TaskStatus }) {
  return (
    <span className={`status ${status}`}>
      <i />
      {statuses[status]}
    </span>
  );
}
const date = (s: string) =>
  new Date(s).toLocaleDateString("en-IN", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });
const time = (s: string) =>
  new Date(s).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
const size = (s: number) =>
  s < 1024
    ? `${s} B`
    : s < 1048576
      ? `${(s / 1024).toFixed(1)} KB`
      : `${(s / 1048576).toFixed(1)} MB`;
function Empty({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FolderOpen;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          "button,input,textarea,select,a[href]",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      prior?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-btn"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export default function App() {
  const [state, setState] = useState<Snapshot>();
  const [paired, setPaired] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [view, setView] = useState<View>("overview");
  const [taskId, setTaskId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [live, setLive] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<{
    type: "memory" | "skill" | "command" | "key" | "artifact" | "approval";
    value?: any;
  }>();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const refresh = async () => {
    const s = await api<Snapshot>("/state");
    setState(s);
    setPaired(true);
  };
  useEffect(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    const token = params.get("code");
    if (token) {
      history.replaceState(null, "", location.pathname);
      setCode(token);
      api("/auth/pair", "POST", { code: token, label: "Personal PC" })
        .then(refresh)
        .catch((e) => {
          setPaired(false);
          setError(e.message);
        });
    } else refresh().catch(() => setPaired(false));
  }, []);
  useEffect(() => {
    if (!paired) return;
    const events = new EventSource("/api/events");
    events.addEventListener("state", (e) => {
      try {
        setState(JSON.parse((e as MessageEvent).data));
        setLive(true);
      } catch {}
    });
    events.onerror = () => {
      setLive(false);
    };
    return () => events.close();
  }, [paired]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [taskId, state?.tasks.find((t) => t.id === taskId)?.messages.length]);
  const act = async (fn: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      if (success) setNotice(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const navigate = (v: View, t?: string) => {
    setView(v);
    setTaskId(t);
    setMobile(false);
    setSearch("");
  };
  const openTask = (t: Task) => navigate("assistant", t.id);
  const task = state?.tasks.find((t) => t.id === taskId);
  const active =
    state?.tasks.filter((t) =>
      ["running", "queued", "waiting_approval", "waiting_input"].includes(
        t.status,
      ),
    ) || [];
  const approvals =
    state?.approvals.filter((a) => a.status === "pending") || [];
  const currentArtifacts =
    state?.artifacts.filter((a) => a.taskId === taskId) || [];
  const suggest = (text: string) => {
    setDraft(text);
    navigate("assistant");
    setTimeout(() => inputRef.current?.focus(), 50);
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    const message = draft.trim();
    await act(async () => {
      const attachments = await Promise.all(
        files.map(async (f) => {
          if (f.size > 8_000_000)
            throw new Error("Each attachment must be smaller than 8 MB.");
          const bytes = new Uint8Array(await f.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 8192)
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          return { name: f.name, base64: btoa(binary) };
        }),
      );
      if (
        task &&
        ["waiting_input", "paused", "failed", "completed"].includes(task.status)
      ) {
        await api(`/tasks/${task.id}/reply`, "POST", {
          message,
          files: attachments,
        });
      } else {
        const created = await api<Task>("/tasks", "POST", {
          prompt: message,
          files: attachments,
        });
        navigate("assistant", created.id);
      }
      setDraft("");
      setFiles([]);
    });
  }
  const composer = (
    <form className="composer" onSubmit={submit}>
      <textarea
        ref={inputRef}
        aria-label="Message Shadow"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={
          task?.status === "waiting_input"
            ? "Reply to Shadow’s question…"
            : "Ask Shadow to research, create, organize, or build…"
        }
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {files.length > 0 && (
        <div className="attachment-chips">
          {files.map((f, i) => (
            <span key={i}>
              <FileText size={12} />
              {f.name}
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles(files.filter((_, j) => i !== j))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-bottom">
        <div className="composer-tools">
          <label className="icon-btn attach" title="Attach files">
            <Paperclip size={18} />
            <input
              type="file"
              multiple
              aria-label="Attach files"
              onChange={(e) =>
                setFiles(
                  [...files, ...Array.from(e.target.files || [])].slice(0, 12),
                )
              }
            />
          </label>
          <span className="model-chip">
            <span className="model-dot" />
            {state?.settings.provider === "agy"
              ? "Gemini · Auto routing"
              : state?.settings.provider}
            <ChevronDown size={12} />
          </span>
        </div>
        <button
          className="send"
          type="submit"
          aria-label="Send message"
          disabled={!draft.trim() || busy}
        >
          {busy ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <ArrowUp size={20} />
          )}
        </button>
      </div>
    </form>
  );
  if (paired === null)
    return (
      <div className="loading-screen">
        <Brand />
        <span>Opening your workspace</span>
        <LoaderCircle size={18} className="spin" />
      </div>
    );
  if (!paired)
    return (
      <div className="pair-screen">
        <div className="pair-brand">
          <Brand />
          shadow<span>YOUR PERSONAL ASSISTANT</span>
        </div>
        <div className="pair-card">
          <span className="eyebrow">
            <ShieldCheck size={14} /> A PRIVATE CONNECTION
          </span>
          <h1>
            Your workspace.
            <br />
            Only your devices.
          </h1>
          <p>
            Enter the pairing code from the Shadow terminal or a device you’ve
            already connected.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await api("/auth/pair", "POST", {
                  code: code.trim(),
                  label: /Mobile|Android|iPhone/i.test(navigator.userAgent)
                    ? "Phone"
                    : "Personal PC",
                });
                setPaired(true);
              });
            }}
          >
            <label>
              Pairing code
              <input
                autoFocus
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Enter your one-time code"
              />
            </label>
            <button className="primary" disabled={busy || !code}>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <KeyRound size={16} />
              )}
              Connect this device
              <ArrowRight size={16} />
            </button>
          </form>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </div>
        <p className="pair-footer">
          <span className="tiny-dot" />
          Runs on your PC. Your files stay with you.
        </p>
      </div>
    );
  if (!state) return null;
  const headerSub: Record<View, string> = {
    overview: "A clear space for everything you want to do.",
    assistant: task
      ? "Your idea, moving forward."
      : "One conversation. More possibilities.",
    tasks: "Keep track of what’s moving, waiting, and done.",
    library: "Everything Shadow has made, in one place.",
    skills: "Workflows that get more useful with you.",
    memory: "A little context goes a long way.",
    connections: "The tools behind your personal assistant.",
    settings: "Make this workspace your own.",
  };
  return (
    <div className={`app-shell anime-shell view-${view} ${task ? "has-task" : ""}`}>
      <div className="sky-lights" aria-hidden="true"><i /><i /><i /></div>
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <div className="wordmark">
          <Brand />
          <span>
            shadow<span className="version">BETA</span>
          </span>
          <button
            className="icon-btn mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={18} />
          </button>
        </div>
        <button
          className="new-task"
          onClick={() => {
            navigate("assistant");
            setDraft("");
          }}
        >
          <Plus size={17} />
          New conversation<span>↗</span>
        </button>
        <span className="nav-label">YOUR LITTLE UNIVERSE</span>
        <nav>
          {nav.map(([key, Icon]) => (
            <button
              key={key}
              className={view === key ? "selected" : ""}
              onClick={() => navigate(key)}
            >
              <Icon size={18} />
              {names[key]}
              {key === "tasks" && active.length > 0 && (
                <span className="nav-count">{active.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-recent">
          <span className="nav-label">RECENT CONVERSATIONS</span>
          {state.tasks.slice(0, 4).map((t) => (
            <button
              key={t.id}
              className={taskId === t.id ? "recent-current" : ""}
              onClick={() => openTask(t)}
            >
              <span className={`task-dot ${t.status}`} />
              <span>{t.title}</span>
            </button>
          ))}
          {!state.tasks.length && <p>Your next idea lives here.</p>}
        </div>
        <div className="sidebar-bottom">
          <nav>
            <button
              className={view === "connections" ? "selected" : ""}
              onClick={() => navigate("connections")}
            >
              <Plug size={18} />
              Connections
              <span className="nav-count">
                {state.connections.filter((c) => c.status === "ready").length}
              </span>
            </button>
            <button
              className={view === "settings" ? "selected" : ""}
              onClick={() => navigate("settings")}
            >
              <Settings2 size={18} />
              Settings
            </button>
          </nav>
          <div className="owner">
            <span className="avatar">Y</span>
            <div>
              <strong>Your workspace</strong>
              <small>Personal · Local-first</small>
            </div>
            <ShieldCheck size={16} />
          </div>
        </div>
      </aside>
      {mobile && <div className="nav-scrim" onClick={() => setMobile(false)} />}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-btn mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <PanelLeft size={19} />
            </button>
            <span>Shadow studio</span>
            <ChevronRight size={13} />
            <strong>{names[view]}</strong>
          </div>
          <div className="topbar-right">
            <span className={`connection-pill ${live ? "online" : ""}`}>
              <i />
              {live ? "Connected to your PC" : "Reconnecting…"}
            </span>
            <button
              className={`review-button ${approvals.length ? "has-review" : ""}`}
              onClick={() => navigate("tasks")}
              title="Approval inbox"
            >
              <ShieldCheck size={17} />
              <span>
                {approvals.length
                  ? `${approvals.length} to review`
                  : "All clear"}
              </span>
            </button>
            <span className="small-avatar">Y</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">A LITTLE MAGIC. REAL PROGRESS.</span>
              <h1>{view === "assistant" && task ? task.title : names[view]}</h1>
              <p>{headerSub[view]}</p>
            </div>
            <span className="today">
              {new Date().toLocaleDateString("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "short",
                timeZone: "Asia/Kolkata",
              })}
            </span>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button
                className="icon-btn"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {(view === "overview" || view === "assistant") && (
            <div className={`workspace-grid ${task ? "with-task" : ""}`}>
              <section className="conversation-area">
                {!task ? (
                  <>
                    <div className="welcome anime-hero">
                      <div className="hero-copy">
                        <span className="welcome-kicker">YOUR EVERYDAY ADVENTURE STARTS HERE</span>
                        <h2>Big ideas.<br /><span>A little Shadow.</span></h2>
                        <p>Your creative companion for the things you want to make, learn, and get done.</p>
                        <div className="hero-chips"><span>✧ Dream it</span><span>✦ Make it</span><span>♡ Make it yours</span></div>
                      </div>
                      {state.settings.companionEnabled && <Companion task={active[0]} voice={state.settings.companionVoice} activity={state.activity.find(a => a.taskId === active[0]?.id)?.message} />}
                    </div>
                    <div className="suggestions">
                      <button onClick={() => suggest("Help me start a digital product business. Research promising opportunities across niches, compare the evidence, recommend a direction and continue with local drafts. Create a business-plan.md, an actual editable guide or template pack, listing copy, and an Instagram launch-calendar.csv. Record assumptions and progress so we can resume. Use my saved preferences and ask only for genuinely blocking information. Prepare Google copies only if I later request them.")}>
                        <span className="suggestion-icon clay"><Sparkles size={18} /></span>
                        <strong>Build a business</strong>
                        <p>Research a direction. Create the product. Plan the launch.</p>
                        <ArrowUpRight size={15} />
                      </button>
                      <button
                        onClick={() =>
                          suggest(
                            "Research a topic for me and create a sourced report. Ask which topic I have in mind.",
                          )
                        }
                      >
                        <span className="suggestion-icon sage">
                          <Search size={18} />
                        </span>
                        <strong>Find clarity</strong>
                        <p>Research, compare, and make sense of things.</p>
                        <ArrowUpRight size={15} />
                      </button>
                      <button
                        onClick={() =>
                          suggest(
                            "Help me create a video from scratch. Ask for my idea, then prepare a script and scene-by-scene production assets.",
                          )
                        }
                      >
                        <span className="suggestion-icon clay">
                          <Video size={18} />
                        </span>
                        <strong>Make something</strong>
                        <p>Turn an idea into content worth sharing.</p>
                        <ArrowUpRight size={15} />
                      </button>
                      <button
                        onClick={() =>
                          suggest(
                            "Help me automate a repetitive task on my PC. Ask what I currently do and inspect the registered tools before proposing a workflow.",
                          )
                        }
                      >
                        <span className="suggestion-icon blue">
                          <Terminal size={18} />
                        </span>
                        <strong>Get work moving</strong>
                        <p>Organize files, build tools, and automate.</p>
                        <ArrowUpRight size={15} />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="thread">
                    {state.settings.companionEnabled && <div className="chat-companion-stage"><Companion task={task} voice={state.settings.companionVoice} activity={state.activity.find(a => a.taskId === task.id)?.message} /><div><span className="welcome-kicker">TOGETHER, ONE STEP AT A TIME</span><h2>Let's bring it to life.</h2><p>Your conversation, work, and decisions stay right here.</p></div></div>}
                    <div className="thread-toolbar">
                      <Status status={task.status} />
                      <span>{task.steps} steps</span>
                      <div className="task-controls">
                        {["running", "queued", "waiting_approval"].includes(
                          task.status,
                        ) && (
                          <button
                            className="secondary small"
                            onClick={() =>
                              void act(() =>
                                api(`/tasks/${task.id}/control`, "POST", {
                                  action: "pause",
                                }),
                              )
                            }
                          >
                            <Pause size={13} />
                            Pause
                          </button>
                        )}
                        {["paused", "failed"].includes(task.status) && (
                          <button
                            className="secondary small"
                            onClick={() =>
                              void act(() =>
                                api(`/tasks/${task.id}/control`, "POST", {
                                  action:
                                    task.status === "failed"
                                      ? "retry"
                                      : "resume",
                                }),
                              )
                            }
                          >
                            <Play size={13} />
                            {task.status === "failed" ? "Retry" : "Resume"}
                          </button>
                        )}
                        {!["completed", "cancelled"].includes(task.status) && (
                          <button
                            className="icon-btn"
                            aria-label="Cancel task"
                            onClick={() =>
                              void act(() =>
                                api(`/tasks/${task.id}/control`, "POST", {
                                  action: "cancel",
                                }),
                              )
                            }
                          >
                            <X size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                    {task.messages
                      .filter(
                        (m) =>
                          !m.content.startsWith("Completion draft for review:"),
                      )
                      .map((m, i) =>
                        m.role === "tool" ? (
                          <details className="tool-message" key={i}>
                            <summary>
                              <Terminal size={13} />
                              Tool result
                              <ChevronDown size={13} />
                            </summary>
                            <pre>{m.content}</pre>
                          </details>
                        ) : (
                          <div className={`message ${m.role}`} key={i}>
                            <span className="message-avatar">
                              {m.role === "assistant" ? <Brand /> : "Y"}
                            </span>
                            <div>
                              <div className="message-label">
                                {m.role === "assistant" ? "Shadow" : "You"}
                                <time>{time(m.at)}</time>
                              </div>
                              <div className="markdown">
                                <Markdown>{m.content}</Markdown>
                              </div>
                            </div>
                          </div>
                        ),
                      )}
                    {task.status === "running" && (
                      <div className="working">
                        <span className="pulse-dots">
                          <i />
                          <i />
                          <i />
                        </span>
                        Shadow is working
                        <span>Steps and outputs appear as they finish.</span>
                      </div>
                    )}
                    {task.error && (
                      <div className="task-error">
                        <AlertCircle size={16} />
                        <span>{task.error}</span>
                      </div>
                    )}
                    {approvals
                      .filter((a) => a.taskId === task.id)
                      .map((a) => (
                        <ApprovalCard
                          key={a.id}
                          approval={a}
                          commands={state.commands}
                          busy={busy}
                          onReview={() =>
                            setModal({ type: "approval", value: a })
                          }
                          onDecide={(approve) =>
                            void act(() =>
                              api(`/approvals/${a.id}`, "POST", { approve }),
                            )
                          }
                        />
                      ))}
                    <div ref={endRef} />
                  </div>
                )}
                {composer}
                <div className="composer-caption">
                  <ShieldCheck size={12} />
                  <span>
                    Local drafts run automatically. You review actions that need
                    your say.
                  </span>
                  <span className="enter-hint">↵ Send · ⇧↵ New line</span>
                </div>
              </section>
              <aside className="context-panel">
                {state.plans?.filter(p => p.id === task?.id).map(plan => <section className="task-roadmap" key={plan.id} aria-label="Task roadmap">
                  <h3>Your roadmap</h3><p>{plan.goal}</p>
                  <ol>{plan.stages.map((stage, index) => <li key={index} data-status={stage.status}>
                    <strong>{stage.title}</strong><small>{stage.status}</small>
                    {stage.evidence && <p>{stage.evidence}</p>}
                    {stage.artifactIds.map(id => { const a = state.artifacts.find(a => a.id === id); return a ? <button className="text-btn" key={id} onClick={() => setModal({ type: "artifact", value: a })}>{a.name}</button> : null; })}
                  </li>)}</ol>
                  <details><summary>Decisions & assumptions</summary>
                    <h4>Decisions</h4><ul>{plan.decisions.map((v, i) => <li key={i}>{v}</li>)}</ul>
                    <h4>Assumptions</h4><ul>{plan.assumptions.map((v, i) => <li key={i}>{v}</li>)}</ul>
                  </details>
                </section>)}
                <div className="context-heading">
                  <span>AT A GLANCE</span>
                  <Activity size={14} />
                </div>
                <div className="context-stats">
                  <div>
                    <strong>{active.length.toString().padStart(2, "0")}</strong>
                    <span>In progress</span>
                  </div>
                  <div>
                    <strong>
                      {state.artifacts.length.toString().padStart(2, "0")}
                    </strong>
                    <span>Files created</span>
                  </div>
                </div>
                {approvals.length > 0 && (
                  <button
                    className="attention-card"
                    onClick={() => navigate("tasks")}
                  >
                    <ShieldCheck size={19} />
                    <div>
                      <strong>Your say, then the next step.</strong>
                      <p>
                        {approvals.length} action
                        {approvals.length > 1 ? "s" : ""} waiting for review.
                      </p>
                    </div>
                    <ArrowRight size={15} />
                  </button>
                )}
                <div className="context-section">
                  <header>
                    <h3>{task ? "Task files" : "Recent activity"}</h3>
                    <button
                      className="text-btn"
                      onClick={() => navigate(task ? "library" : "tasks")}
                    >
                      View all
                      <ArrowUpRight size={12} />
                    </button>
                  </header>
                  {task ? (
                    currentArtifacts.length ? (
                      currentArtifacts.slice(0, 6).map((a) => (
                        <button
                          key={a.id}
                          className="compact-file"
                          onClick={() =>
                            setModal({ type: "artifact", value: a })
                          }
                        >
                          <FileText size={16} />
                          <span>
                            {a.name}
                            <small>{size(a.size)}</small>
                          </span>
                          <ArrowUpRight size={13} />
                        </button>
                      ))
                    ) : (
                      <p className="muted-small">
                        Files will appear here as Shadow creates them.
                      </p>
                    )
                  ) : state.activity.length ? (
                    state.activity.slice(0, 5).map((a) => (
                      <div className="activity-item" key={a.id}>
                        <span className={`activity-dot ${a.type}`} />
                        <div>
                          <p>{a.message}</p>
                          <time>{time(a.at)}</time>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="quiet-state">
                      <span className="quiet-orbit" />
                      <p>
                        A fresh start.
                        <br />
                        Your progress will show up here.
                      </p>
                    </div>
                  )}
                </div>
                <div className="context-section tool-context">
                  <header>
                    <h3>Connected tools</h3>
                    <button
                      className="text-btn"
                      onClick={() => navigate("connections")}
                    >
                      Manage
                      <ArrowUpRight size={12} />
                    </button>
                  </header>
                  {state.connections
                    .filter((c) => ["agy", "browser", "ffmpeg"].includes(c.id))
                    .map((c) => (
                      <div className="connected-tool" key={c.id}>
                        <span className="tool-mini-icon">
                          {c.id === "agy" ? (
                            <Sparkles size={15} />
                          ) : c.id === "browser" ? (
                            <Globe size={15} />
                          ) : (
                            <Video size={15} />
                          )}
                        </span>
                        <span>{c.name}</span>
                        <i
                          className={c.status === "ready" ? "ready" : ""}
                          title={c.status}
                        />
                      </div>
                    ))}
                </div>
                <div className="private-note">
                  <ShieldCheck size={18} />
                  <strong>Made for your space.</strong>
                  <p>
                    Your history and files are stored on this PC. Model requests
                    use the provider you choose.
                  </p>
                </div>
              </aside>
            </div>
          )}
          {view === "tasks" && (
            <>
              <div className="section-bar">
                <div className="tabs">
                  <span className="active">
                    All tasks <b>{state.tasks.length}</b>
                  </span>
                  <span>{active.length} active</span>
                </div>
                <button
                  className="primary small"
                  onClick={() => navigate("assistant")}
                >
                  <Plus size={15} />
                  New task
                </button>
              </div>
              {approvals.length > 0 && (
                <section className="approval-section">
                  <h2>
                    <ShieldCheck size={18} />
                    Approval inbox <span>{approvals.length}</span>
                  </h2>
                  {approvals.map((a) => (
                    <ApprovalCard
                      key={a.id}
                      approval={a}
                      commands={state.commands}
                      busy={busy}
                      onReview={() => setModal({ type: "approval", value: a })}
                      onDecide={(approve) =>
                        void act(() =>
                          api(`/approvals/${a.id}`, "POST", { approve }),
                        )
                      }
                    />
                  ))}
                </section>
              )}
              {state.tasks.length ? (
                <div className="task-list">
                  {state.tasks.map((t) => (
                    <button
                      key={t.id}
                      className="task-row"
                      onClick={() => openTask(t)}
                    >
                      <span className={`task-row-icon ${t.status}`}>
                        {t.status === "completed" ? (
                          <Check size={17} />
                        ) : t.status === "running" ? (
                          <LoaderCircle size={17} className="spin" />
                        ) : (
                          <MessageSquare size={17} />
                        )}
                      </span>
                      <div>
                        <strong>{t.title}</strong>
                        <span>
                          {t.steps} steps · {date(t.createdAt)}
                        </span>
                      </div>
                      <Status status={t.status} />
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </div>
              ) : (
                <Empty icon={ListTodo} title="A clear queue, a fresh start.">
                  Start a conversation and Shadow will keep track of the work
                  here.
                </Empty>
              )}
            </>
          )}
          {view === "library" && (
            <>
              <div className="section-bar">
                <span className="section-description">
                  {state.artifacts.length} files · Stored on your PC
                </span>
                <div className="search-field">
                  <Search size={15} />
                  <input
                    aria-label="Search files"
                    placeholder="Find a file…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              {state.artifacts.length ? (
                <div className="artifact-grid">
                  {state.artifacts
                    .filter((a) =>
                      a.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((a) => (
                      <button
                        className="artifact-card"
                        key={a.id}
                        onClick={() => setModal({ type: "artifact", value: a })}
                      >
                        <div
                          className={`artifact-cover ${a.mime.startsWith("image/") ? "image-cover" : ""}`}
                        >
                          {a.mime.startsWith("image/") ? (
                            <img
                              src={`/api/artifacts/${a.id}/content`}
                              alt={a.name}
                            />
                          ) : a.mime.startsWith("video/") ? (
                            <Video size={38} />
                          ) : a.mime.startsWith("audio/") ? (
                            <Music size={38} />
                          ) : (
                            <FileText size={38} />
                          )}
                          <span>{a.name.split(".").pop()?.toUpperCase()}</span>
                        </div>
                        <div className="artifact-info">
                          <strong>{a.name}</strong>
                          <p>
                            {size(a.size)}
                            <span>{date(a.createdAt)}</span>
                          </p>
                        </div>
                      </button>
                    ))}
                </div>
              ) : (
                <Empty icon={FolderOpen} title="Room for your next creation.">
                  Reports, scripts, images, audio, and videos will appear here
                  as tasks finish.
                </Empty>
              )}
            </>
          )}
          {view === "memory" && (
            <>
              <div className="section-bar">
                <span className="section-description">
                  Preferences and context, always editable.
                </span>
                <button
                  className="primary small"
                  onClick={() => setModal({ type: "memory" })}
                >
                  <Plus size={15} />
                  Add memory
                </button>
              </div>
              <div className="info-strip">
                <Brain size={18} />
                <span>
                  Shadow uses relevant memories to personalize its work. You can
                  change or remove any of them.
                </span>
              </div>
              {state.memories.length ? (
                <div className="memory-list">
                  {state.memories.map((m) => (
                    <article className="memory-card" key={m.id}>
                      <span className="memory-marker">
                        <Brain size={16} />
                      </span>
                      <div>
                        <p>{m.text}</p>
                        <span>
                          {m.source} · {date(m.updatedAt)}
                        </span>
                      </div>
                      <button
                        className="icon-btn"
                        aria-label="Edit memory"
                        onClick={() => setModal({ type: "memory", value: m })}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label="Delete memory"
                        onClick={() => {
                          if (confirm("Delete this saved memory?"))
                            void act(() => api(`/memories/${m.id}`, "DELETE"));
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={Brain}
                  title="Let’s get to know your way of working."
                >
                  Add a preference, or correct Shadow in a conversation so it
                  can remember.
                </Empty>
              )}
            </>
          )}
          {view === "skills" && (
            <>
              <div className="section-bar">
                <span className="section-description">
                  {state.skills.filter((s) => s.enabled).length} active skills ·
                  No fixed niche
                </span>
                <button
                  className="primary small"
                  onClick={() => setModal({ type: "skill" })}
                >
                  <Plus size={15} />
                  Create skill
                </button>
              </div>
              <div className="info-strip">
                <BookOpen size={18} />
                <span>
                  Skills combine instructions with example tool recipes. Tests
                  verify the recipe, while each new task still needs its own
                  evidence.
                </span>
              </div>
              <div className="skill-grid">
                {state.skills.map((s, i) => (
                  <article className="skill-card" key={s.id}>
                    <div className="skill-card-top">
                      <span
                        className={`suggestion-icon ${["sage", "blue", "clay"][i % 3]}`}
                      >
                        <BookOpen size={19} />
                      </span>
                      <span
                        className={`skill-state ${s.enabled ? "enabled" : ""}`}
                      >
                        {s.enabled
                          ? "Active"
                          : s.status === "tested"
                            ? "Tested"
                            : "Draft"}
                      </span>
                    </div>
                    <h3>{s.name}</h3>
                    <p>{s.description}</p>
                    <div className="skill-tags">
                      {s.triggers.slice(0, 3).map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                    <footer>
                      <span>
                        v{s.version} · {s.recipe.length} recipe steps
                      </span>
                      <button
                        className="text-btn"
                        onClick={() => setModal({ type: "skill", value: s })}
                      >
                        Configure
                        <ArrowUpRight size={13} />
                      </button>
                    </footer>
                    <div className="skill-actions">
                      <button
                        className="secondary small"
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            const t = await api<Task>(
                              `/skills/${s.id}/test`,
                              "POST",
                              {},
                            );
                            openTask(t);
                          })
                        }
                      >
                        <Play size={13} />
                        Test recipe
                      </button>
                      {s.status === "tested" && (
                        <button
                          className="secondary small"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              api(`/skills/${s.id}/toggle`, "POST", {}),
                            )
                          }
                        >
                          {s.enabled ? "Disable" : "Enable"}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
          {view === "connections" && (
            <>
              <div className="section-bar">
                <span className="section-description">
                  Your accounts. Your tools. One workspace.
                </span>
                <span className="subtle-badge">
                  <ShieldCheck size={13} />
                  Credentials stay on this PC
                </span>
              </div>
              <div className="connection-grid">
                {state.connections.map((c) => (
                  <article className="connection-card" key={c.id}>
                    <div className="connection-card-top">
                      <span
                        className={`integration-icon ${c.category.toLowerCase()}`}
                      >
                        {c.category === "Intelligence" ? (
                          <Sparkles size={21} />
                        ) : c.id === "tailscale" ? (
                          <Smartphone size={21} />
                        ) : c.category === "Creative" ? (
                          <Video size={21} />
                        ) : (
                          <Globe size={21} />
                        )}
                      </span>
                      <span className={`connection-status ${c.status}`}>
                        <i />
                        {c.status === "ready"
                          ? "Available"
                          : c.status === "needs_login"
                            ? "Sign in needed"
                            : c.status === "error"
                              ? "Check setup"
                              : "Set up"}
                      </span>
                    </div>
                    <h3>{c.name}</h3>
                    <span className="connection-category">{c.category}</span>
                    <p>{c.detail}</p>
                    <footer>
                      {c.id === "browser" && (
                        <button
                          className="secondary small"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () =>
                                api("/connections/browser/login", "POST", {}),
                              "Normal Chrome opened. Sign in to Google, then close that Chrome window before using Shadow's browser.",
                            )
                          }
                        >
                          <KeyRound size={13} />
                          Google sign-in
                        </button>
                      )}
                      {["browser", "flow", "elevenlabs"].includes(c.id) && (
                        <button
                          className="secondary small"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () =>
                                api(`/connections/${c.id}/open`, "POST", {}),
                              "Browser opened. Complete sign-in directly on your PC.",
                            )
                          }
                        >
                          <ExternalLink size={13} />
                          Open browser
                        </button>
                      )}
                      {["gemini", "groq", "openrouter"].includes(c.id) && (
                        <button
                          className="secondary small"
                          onClick={() => setModal({ type: "key", value: c })}
                        >
                          <KeyRound size={13} />
                          API key
                        </button>
                      )}
                      {c.id !== "browser" && c.id !== "omnistudio" && (
                        <button
                          className="text-btn"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              api(`/connections/${c.id}/check`, "POST", {}),
                            )
                          }
                        >
                          Check
                          <RotateCcw size={12} />
                        </button>
                      )}
                      {c.id === "omnistudio" && (
                        <button
                          className="text-btn"
                          onClick={() => setModal({ type: "command" })}
                        >
                          Register launcher
                          <ArrowUpRight size={12} />
                        </button>
                      )}
                    </footer>
                  </article>
                ))}
              </div>
              <section className="commands-section">
                <div className="section-bar">
                  <div>
                    <h2>Local launchers</h2>
                    <p>
                      Exact programs and arguments. Reviewed before each
                      execution.
                    </p>
                  </div>
                  <button
                    className="secondary small"
                    onClick={() => setModal({ type: "command" })}
                  >
                    <Plus size={14} />
                    Register command
                  </button>
                </div>
                {state.commands.length ? (
                  state.commands.map((c) => (
                    <div className="command-row" key={c.id}>
                      <Terminal size={19} />
                      <div>
                        <strong>{c.name}</strong>
                        <code>
                          {c.executable} {c.args.join(" ")}
                        </code>
                        <small>{c.cwd}</small>
                      </div>
                      <button
                        className="icon-btn"
                        aria-label={`Remove ${c.name}`}
                        onClick={() => {
                          if (confirm("Remove this registered command?"))
                            void act(() => api(`/commands/${c.id}`, "DELETE"));
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty-inline">
                    <Terminal size={20} />
                    <p>
                      Connect your <code>shorts</code> tool, OmniStudio
                      launcher, or a local build command.
                    </p>
                  </div>
                )}
              </section>
            </>
          )}
          {view === "settings" && (
            <SettingsPanel
              settings={state.settings}
              busy={busy}
              act={act}
              notice={setNotice}
            />
          )}
        </main>
        <footer className="app-footer">
          <span>
            <span className="tiny-dot" />
            Shadow · A workspace that works with you.
          </span>
          <span>Local-first. Human-guided.</span>
        </footer>
      </div>
      <nav className="mobile-bottom">
        {(
          [
            ["overview", LayoutDashboard],
            ["assistant", MessageSquare],
            ["tasks", ListTodo],
            ["library", FolderOpen],
          ] as const
        ).map(([v, Icon]) => (
          <button
            className={view === v ? "selected" : ""}
            key={v}
            onClick={() => navigate(v)}
          >
            <Icon size={19} />
            <span>{names[v]}</span>
          </button>
        ))}
        <button onClick={() => setMobile(true)}>
          <MoreHorizontal size={20} />
          <span>More</span>
        </button>
      </nav>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {error && modal && (
        <div className="toast" role="alert">
          <AlertCircle size={17} />
          {error}
        </div>
      )}
      {modal?.type === "memory" && (
        <MemoryEditor
          value={modal.value}
          onClose={() => setModal(undefined)}
          onSave={async (b) => {
            await act(async () => {
              await api(
                modal.value ? `/memories/${modal.value.id}` : "/memories",
                modal.value ? "PUT" : "POST",
                b,
              );
              setModal(undefined);
            }, "Memory saved.");
          }}
        />
      )}
      {modal?.type === "skill" && (
        <SkillEditor
          value={modal.value}
          busy={busy}
          onClose={() => setModal(undefined)}
          onSave={async (b) => {
            await act(async () => {
              await api(
                modal.value ? `/skills/${modal.value.id}` : "/skills",
                modal.value ? "PUT" : "POST",
                b,
              );
              setModal(undefined);
            }, "Skill saved as a draft. Test its recipe before activation.");
          }}
          onRollback={async (version) => {
            await act(async () => {
              await api(`/skills/${modal.value.id}/rollback`, "POST", {
                version,
              });
              setModal(undefined);
            }, "Version restored. Test it before activation.");
          }}
        />
      )}
      {modal?.type === "command" && (
        <CommandEditor
          onClose={() => setModal(undefined)}
          onSave={async (b) => {
            await act(async () => {
              await api("/commands", "POST", b);
              setModal(undefined);
            }, "Launcher registered. Execution still requires review.");
          }}
        />
      )}
      {modal?.type === "key" && (
        <KeyEditor
          connection={modal.value}
          onClose={() => setModal(undefined)}
          onSave={async (key) => {
            await act(async () => {
              await api(`/connections/${modal.value.id}/key`, "POST", { key });
              setModal(undefined);
            }, "Key saved locally. Configure the model and allowance in Settings.");
          }}
        />
      )}
      {modal?.type === "artifact" && (
        <ArtifactPreview
          artifact={modal.value}
          onClose={() => setModal(undefined)}
        />
      )}
      {modal?.type === "approval" && (
        <ApprovalPreview
          approval={modal.value}
          commands={state.commands}
          onClose={() => setModal(undefined)}
        />
      )}
    </div>
  );
}
function ApprovalCard({
  approval: a,
  commands,
  busy,
  onDecide,
  onReview,
}: {
  approval: Approval;
  commands: CommandRegistration[];
  busy: boolean;
  onDecide: (v: boolean) => void;
  onReview: () => void;
}) {
  const command =
    a.request.tool === "command.run" &&
    commands.find((c) => c.id === a.request.args.commandId);
  return (
    <article className="approval-card">
      <header>
        <span className="approval-icon">
          <ShieldCheck size={19} />
        </span>
        <div>
          <strong>{a.request.summary || a.request.tool}</strong>
          <span>{a.request.tool}</span>
        </div>
        <span className="subtle-badge">Your review</span>
      </header>
      <p>{a.reason}</p>
      {typeof a.request.args._pageUrl === "string" && (
        <code className="command-preview">{a.request.args._pageUrl}</code>
      )}
      {command && (
        <code className="command-preview">
          {command.executable} {command.args.join(" ")}
        </code>
      )}
      <footer>
        <button className="text-btn" onClick={onReview}>
          Inspect action
          <ArrowUpRight size={13} />
        </button>
        <div>
          <button
            className="secondary small"
            disabled={busy}
            onClick={() => onDecide(false)}
          >
            Deny
          </button>
          <button
            className="primary small"
            disabled={busy}
            onClick={() => onDecide(true)}
          >
            <Check size={13} />
            Approve once
          </button>
        </div>
      </footer>
    </article>
  );
}
function MemoryEditor({
  value,
  onClose,
  onSave,
}: {
  value?: Memory;
  onClose: () => void;
  onSave: (b: { text: string; source: string }) => Promise<void>;
}) {
  const [text, setText] = useState(value?.text || "");
  return (
    <Modal title={value ? "Edit memory" : "Add a memory"} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave({ text, source: "Owner edit" });
        }}
      >
        <p className="form-note">
          A preference, correction, or piece of context you want Shadow to
          remember.
        </p>
        <label>
          Memory
          <textarea
            required
            autoFocus
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            placeholder="For example: I prefer concise English scripts and editable source files."
          />
        </label>
        <div className="form-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Save memory
          </button>
        </div>
      </form>
    </Modal>
  );
}
function CommandEditor({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (b: Omit<CommandRegistration, "id">) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [executable, setExecutable] = useState(""),
    [args, setArgs] = useState("[]"),
    [cwd, setCwd] = useState(""),
    [outputs, setOutputs] = useState(""),
    [description, setDescription] = useState(""),
    [error, setError] = useState("");
  return (
    <Modal title="Register a local launcher" onClose={onClose} wide>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const parsed = JSON.parse(args);
            if (
              !Array.isArray(parsed) ||
              parsed.some((x) => typeof x !== "string")
            )
              throw new Error("Arguments must be a JSON array of strings.");
            void onSave({
              name,
              executable,
              args: parsed,
              cwd,
              expectedOutputs: outputs
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
              description,
            });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <p className="form-note">
          Register a real program, not a guessed command. For a PowerShell
          script, use the full PowerShell executable path with{" "}
          <code>["-NoProfile", "-File", "C:\\path\\script.ps1"]</code> as
          arguments.
        </p>
        <label>
          Name
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My shorts tool"
          />
        </label>
        <label>
          Executable
          <input
            required
            value={executable}
            onChange={(e) => setExecutable(e.target.value)}
            placeholder="C:\path\program.exe"
          />
        </label>
        <label>
          Fixed arguments · JSON array
          <textarea
            rows={2}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
          />
        </label>
        <label>
          Working folder
          <input
            required
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="E:\my-project"
          />
        </label>
        <label>
          Expected output files · One relative path per line
          <textarea
            rows={2}
            value={outputs}
            onChange={(e) => setOutputs(e.target.value)}
            placeholder="output/video.mp4"
          />
        </label>
        <label>
          Purpose
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this launcher does"
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="form-footer">
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Register launcher</button>
        </div>
      </form>
    </Modal>
  );
}
function SkillEditor({
  value,
  onClose,
  onSave,
  onRollback,
  busy,
}: {
  value?: Skill;
  onClose: () => void;
  onSave: (b: any) => Promise<void>;
  onRollback: (n: number) => Promise<void>;
  busy: boolean;
}) {
  const [name, setName] = useState(value?.name || ""),
    [description, setDescription] = useState(value?.description || ""),
    [triggers, setTriggers] = useState(value?.triggers.join(", ") || ""),
    [instructions, setInstructions] = useState(value?.instructions || ""),
    [recipe, setRecipe] = useState(
      JSON.stringify(
        value?.recipe || [
          {
            tool: "file.write",
            args: { path: "draft.md", content: "# Draft\n" },
            summary: "Create a local draft",
          },
        ],
        null,
        2,
      ),
    ),
    [error, setError] = useState("");
  return (
    <Modal
      title={value ? "Configure skill" : "Create a skill"}
      onClose={onClose}
      wide
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            void onSave({
              name,
              description,
              triggers: triggers
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              instructions,
              recipe: JSON.parse(recipe),
            });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <div className="form-columns">
          <label>
            Name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Triggers · Comma separated
            <input
              required
              value={triggers}
              onChange={(e) => setTriggers(e.target.value)}
              placeholder="research, report"
            />
          </label>
        </div>
        <label>
          Description
          <input
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          Instructions
          <textarea
            required
            rows={5}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        <label>
          Example tool recipe · JSON
          <textarea
            required
            className="code-input"
            rows={8}
            value={recipe}
            onChange={(e) => setRecipe(e.target.value)}
          />
        </label>
        <p className="form-note">
          Tests execute these exact example arguments in a new task folder.
          Reviewed actions still need your approval. Editing creates a new draft
          version.
        </p>
        {value?.history.length ? (
          <div className="version-history">
            <span>Version history</span>
            {value.history.map((h) => (
              <button
                disabled={busy}
                type="button"
                className="secondary small"
                key={h.version}
                onClick={() => void onRollback(h.version)}
              >
                <RotateCcw size={12} />
                Restore v{h.version}
              </button>
            ))}
          </div>
        ) : null}
        {error && <p className="error-text">{error}</p>}
        <div className="form-footer">
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Save draft
          </button>
        </div>
      </form>
    </Modal>
  );
}
function KeyEditor({
  connection,
  onClose,
  onSave,
}: {
  connection: Connection;
  onClose: () => void;
  onSave: (s: string) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  return (
    <Modal title={`${connection.name} API key`} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(key.trim());
        }}
      >
        <p className="form-note">
          Use a key from your own account. Keys are encrypted on this PC and
          never returned to the interface or sent to the planner. Configure the
          model and confirm its allowance in Settings.
        </p>
        <label>
          API key
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your API key"
          />
        </label>
        <div className="form-footer">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">
            {key ? "Save key" : "Remove saved key"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function ArtifactPreview({
  artifact: a,
  onClose,
}: {
  artifact: Artifact;
  onClose: () => void;
}) {
  const [text, setText] = useState(""),
    [error, setError] = useState("");
  const src = `/api/artifacts/${a.id}/content`;
  useEffect(() => {
    if (a.mime.startsWith("text/") || a.mime === "application/json")
      fetch(src)
        .then((r) => {
          if (!r.ok) throw new Error("Could not load the file.");
          return r.text();
        })
        .then((s) => setText(s.slice(0, 200000)))
        .catch((e) => setError(e.message));
  }, [src]);
  return (
    <Modal title={a.name} onClose={onClose} wide>
      <div className="artifact-preview">
        {a.mime.startsWith("image/") ? (
          <img src={src} alt={a.name} />
        ) : a.mime.startsWith("video/") ? (
          <video src={src} controls />
        ) : a.mime.startsWith("audio/") ? (
          <audio src={src} controls />
        ) : a.mime === "text/markdown" ? (
          <div className="markdown">
            <Markdown>{text}</Markdown>
          </div>
        ) : text ? (
          <pre>{text}</pre>
        ) : (
          <p className="form-note">
            {error ||
              "Download this file to open it in your preferred application."}
          </p>
        )}
      </div>
      <div className="form-footer preview-footer">
        <span>
          {size(a.size)} · {date(a.createdAt)}
        </span>
        <a className="primary" href={src + "?download=1"} download={a.name}>
          <Download size={15} />
          Download
        </a>
      </div>
    </Modal>
  );
}
function ApprovalPreview({
  approval: a,
  commands,
  onClose,
}: {
  approval: Approval;
  commands: CommandRegistration[];
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  useEffect(() => {
    if (a.request.tool === "code.run")
      api<{ content: string }>(`/approvals/${a.id}/code`)
        .then((r) => setCode(r.content))
        .catch((e) => setCode(e.message));
  }, [a.id]);
  const registration = commands.find((c) => c.id === a.request.args.commandId);
  return (
    <Modal title="Inspect requested action" onClose={onClose} wide>
      <div className="form">
        <p>{a.reason}</p>
        <pre className="code-preview">
          {JSON.stringify(
            {
              ...a.request,
              args: Object.fromEntries(
                Object.entries(a.request.args).filter(
                  ([key]) => !key.startsWith("_"),
                ),
              ),
              page: a.request.args._pageUrl,
            },
            null,
            2,
          )}
        </pre>
        {registration && (
          <>
            <h3>Registered launcher</h3>
            <pre className="code-preview">
              {JSON.stringify(registration, null, 2)}
            </pre>
          </>
        )}
        {code && (
          <>
            <h3>Code to execute</h3>
            <pre className="code-preview">{code}</pre>
          </>
        )}
        <p className="form-note">
          This approval applies only to the saved action. Modified command
          registrations, code, or browser destinations require a new review.
        </p>
      </div>
    </Modal>
  );
}
function SettingsPanel({
  settings,
  busy,
  act,
  notice,
}: {
  settings: Settings;
  busy: boolean;
  act: (fn: () => Promise<unknown>, success?: string) => Promise<void>;
  notice: (s: string) => void;
}) {
  const [s, setS] = useState(settings),
    [pairCode, setPairCode] = useState(""),
    [models, setModels] = useState<string[]>([]),
    [devices, setDevices] = useState<
      { id: string; label: string; createdAt: string }[]
    >([]);
  useEffect(() => {
    api<{ models: string[] }>("/models").then((r) => setModels(r.models));
    api("/auth/devices").then(setDevices);
  }, []);
  return (
    <div className="settings-grid">
      <form
        className="settings-card form"
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => api("/settings", "PUT", s), "Settings saved.");
        }}
      >
        <div className="settings-title">
          <Sparkles size={20} />
          <div>
            <h2>Intelligence & execution</h2>
            <p>Choose how Shadow plans and gets work done.</p>
          </div>
        </div>
        <label>
          Initiative
          <select value={s.initiative} onChange={e => setS({ ...s, initiative: e.target.value as Settings["initiative"] })}>
            <option value="ask">Ask me about strategic choices</option>
            <option value="recommend">Recommend and continue</option>
            <option value="decide">Decide within my boundaries</option>
          </select>
        </label>
        <p className="form-note">Shadow uses research and your preferences to make routine choices. Purchases, publishing, messaging, and other reviewed tools still require approval.</p>
        <label className="checkbox-label"><input type="checkbox" checked={s.companionEnabled} onChange={e => setS({ ...s, companionEnabled: e.target.checked })} />Show anime companion</label>
        <label className="checkbox-label"><input type="checkbox" checked={s.companionVoice} onChange={e => setS({ ...s, companionVoice: e.target.checked })} />Optional short voice cues using installed device voices</label>
        <label>
          Primary provider
          <select
            value={s.provider}
            onChange={(e) =>
              setS({ ...s, provider: e.target.value as Settings["provider"] })
            }
          >
            <option value="agy">Antigravity CLI · Existing account</option>
            <option value="gemini">Gemini API</option>
            <option value="groq">Groq API</option>
            <option value="openrouter">OpenRouter · Free models only</option>
          </select>
        </label>
        <div className="form-columns">
          <label>
            Planning & review model
            <input
              list="models"
              value={s.plannerModel}
              onChange={(e) => setS({ ...s, plannerModel: e.target.value })}
            />
          </label>
          <label>
            Routine task model
            <input
              list="models"
              value={s.workerModel}
              onChange={(e) => setS({ ...s, workerModel: e.target.value })}
            />
          </label>
        </div>
        <datalist id="models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <label>
          Antigravity CLI executable
          <input
            value={s.agyPath}
            onChange={(e) => setS({ ...s, agyPath: e.target.value })}
          />
        </label>
        <div className="form-columns">
          <label>
            Steps per task
            <input
              type="number"
              min={4}
              max={100}
              value={s.maxSteps}
              onChange={(e) => setS({ ...s, maxSteps: Number(e.target.value) })}
            />
          </label>
          <label>
            Model calls per day · India time
            <input
              type="number"
              min={1}
              max={2000}
              value={s.maxDailyCalls}
              onChange={(e) =>
                setS({ ...s, maxDailyCalls: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <label>
          Dedicated browser
          <select
            value={s.browserChannel}
            onChange={(e) =>
              setS({
                ...s,
                browserChannel: e.target.value as "chrome" | "msedge",
              })
            }
          >
            <option value="chrome">Google Chrome</option>
            <option value="msedge">Microsoft Edge</option>
          </select>
        </label>
        <details className="api-settings">
          <summary>
            Optional API providers
            <ChevronDown size={14} />
          </summary>
          <p className="form-note">
            Account plans and API allowances are separate. No automatic
            paid-model fallback or credit purchases are implemented.
          </p>
          {(["gemini", "groq", "openrouter"] as const).map((p) => (
            <div className="provider-setting" key={p}>
              <label>
                {p} model
                <input
                  value={s.apiModels[p]}
                  onChange={(e) =>
                    setS({
                      ...s,
                      apiModels: { ...s.apiModels, [p]: e.target.value },
                    })
                  }
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={s.freeAllowanceConfirmed[p]}
                  onChange={(e) =>
                    setS({
                      ...s,
                      freeAllowanceConfirmed: {
                        ...s.freeAllowanceConfirmed,
                        [p]: e.target.checked,
                      },
                    })
                  }
                />
                I verified this account/model uses my free or existing
                allowance.
              </label>
            </div>
          ))}
        </details>
        <button className="primary" disabled={busy}>
          <Check size={15} />
          Save settings
        </button>
      </form>
      <div className="settings-side">
        <section className="settings-card form">
          <div className="settings-title">
            <Smartphone size={20} />
            <div>
              <h2>Private phone access</h2>
              <p>Your PC does the work. Your phone stays in the loop.</p>
            </div>
          </div>
          <ol className="setup-steps">
            <li>
              Install Tailscale on your PC and phone, and sign in to the same
              private network.
            </li>
            <li>
              On your PC, run{" "}
              <code>tailscale serve --bg http://127.0.0.1:4310</code>.
            </li>
            <li>
              Save the HTTPS <code>.ts.net</code> address below. Open it on your
              phone with Tailscale connected.
            </li>
            <li>Generate a pairing code and enter it on your phone.</li>
          </ol>
          <label>
            Private HTTPS address
            <input
              value={s.publicUrl}
              onChange={(e) => setS({ ...s, publicUrl: e.target.value.trim() })}
              placeholder="https://your-pc.your-network.ts.net"
            />
          </label>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void act(
                () => api("/settings", "PUT", s),
                "Private address saved.",
              )
            }
          >
            <Check size={15} />
            Save private address
          </button>
          <button
            className="secondary"
            onClick={() =>
              void act(async () => {
                const r = await api<{ code: string }>(
                  "/auth/pair-code",
                  "POST",
                  {},
                );
                setPairCode(r.code);
              })
            }
          >
            <KeyRound size={15} />
            Generate pairing code
          </button>
          {pairCode && (
            <div className="pair-code">
              <code>{pairCode}</code>
              <button
                className="icon-btn"
                aria-label="Copy pairing code"
                onClick={() => {
                  navigator.clipboard
                    .writeText(pairCode)
                    .then(() => notice("Pairing code copied."));
                }}
              >
                <Copy size={16} />
              </button>
              <small>One use · Expires in 10 minutes</small>
            </div>
          )}
          <p className="form-note">
            Keep your PC awake and Shadow running. Tailscale Serve keeps access
            inside your private network.
          </p>
        </section>
        <section className="settings-card form">
          <div className="settings-title">
            <ShieldCheck size={20} />
            <div>
              <h2>Paired devices</h2>
              <p>Only paired devices can use this workspace.</p>
            </div>
          </div>
          {devices.map((d) => (
            <div className="device-row" key={d.id}>
              <Smartphone size={16} />
              <div>
                <strong>{d.label}</strong>
                <small>Paired {date(d.createdAt)}</small>
              </div>
              <button
                className="text-btn danger"
                onClick={() => {
                  if (confirm(`Revoke access for ${d.label}?`))
                    void act(async () => {
                      await api(`/auth/devices/${d.id}`, "DELETE");
                      setDevices(devices.filter((x) => x.id !== d.id));
                    });
                }}
              >
                Revoke
              </button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
