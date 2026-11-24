import type { WorkflowExecutionRecord } from "../schemas.js";

/**
 * In-memory idempotency store keyed by event_id.
 * Prevents duplicate webhook deliveries from re-running Gemini or triggering duplicate actions.
 * In production on GCP, back this interface with Firestore or Cloud Memorystore (Redis).
 */
export class IdempotencyStore {
  private readonly records = new Map<string, WorkflowExecutionRecord>();

  get(eventId: string): WorkflowExecutionRecord | undefined {
    return this.records.get(eventId);
  }

  set(eventId: string, record: WorkflowExecutionRecord): void {
    this.records.set(eventId, record);
  }

  list(): WorkflowExecutionRecord[] {
    return Array.from(this.records.values()).reverse();
  }

  clear(): void {
    this.records.clear();
  }
}
