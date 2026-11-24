import { z } from "zod";

export const WebhookEventSchema = z.object({
  event_id: z.string().min(3).max(128),
  source: z.enum(["google-workspace", "jira", "gcp-monitoring", "custom"]),
  title: z.string().min(3).max(200),
  body: z.string().min(5).max(4000),
  requester: z.string().min(2).max(120).default("unknown"),
});

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

export const TriageResultSchema = z.object({
  category: z.enum(["incident", "access-request", "automation", "general"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  summary: z.string().min(5).max(300),
  target_queue: z.string().min(2).max(80),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;

export interface WorkflowExecutionRecord {
  event_id: string;
  source: WebhookEvent["source"];
  triage: TriageResult;
  dispatch: {
    delivered: boolean;
    attempts: number;
    target_queue: string;
  };
  model: string;
  processed_at: string;
}
