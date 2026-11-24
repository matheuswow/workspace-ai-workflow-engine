import type { TriageResult, WebhookEvent } from "../schemas.js";
import { withExponentialBackoff } from "./retry.js";

export interface DispatchResult {
  delivered: boolean;
  attempts: number;
  target_queue: string;
}

export type ActionSender = (
  event: WebhookEvent,
  triage: TriageResult,
  attempt: number,
) => Promise<void>;

const defaultSender: ActionSender = async () => {
  // In production, POST to Google Chat, Slack, Pub/Sub, or Jira REST API.
  return;
};

export class ActionDispatcher {
  constructor(
    private readonly sender: ActionSender = defaultSender,
    private readonly maxAttempts = 3,
    private readonly baseDelayMs = 40,
  ) {}

  async dispatch(event: WebhookEvent, triage: TriageResult): Promise<DispatchResult> {
    const outcome = await withExponentialBackoff(
      async (attempt) => {
        await this.sender(event, triage, attempt);
        return true;
      },
      { maxAttempts: this.maxAttempts, baseDelayMs: this.baseDelayMs },
    );

    return {
      delivered: outcome.value,
      attempts: outcome.attempts,
      target_queue: triage.target_queue,
    };
  }
}
