import { z } from "zod";
import type { AgentDecision } from "../shared/types.js";
export const toolRequestSchema = z.object({
  tool: z.string().min(1).max(100),
  args: z.record(z.string(), z.unknown()),
  summary: z.string().max(1000),
});
export const decisionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("tool"),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()),
    summary: z.string().max(1000),
  }),
  z.object({
    kind: z.enum(["done", "ask"]),
    message: z.string().min(1).max(40000),
  }),
]);
// Required, flat fields work across CLI schema output and OpenAI-compatible providers.
export const DECISION_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["tool", "done", "ask"] },
    tool: { type: "string" },
    args: { type: "object" },
    summary: { type: "string" },
    message: { type: "string" },
  },
  required: ["kind"],
  additionalProperties: false,
};
export function parseDecision(value: unknown): AgentDecision {
  if (typeof value === "string") {
    const raw = value
      .trim()
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, "");
    value = JSON.parse(raw);
  }
  return decisionSchema.parse(value) as AgentDecision;
}
