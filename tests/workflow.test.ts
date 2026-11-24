import { createHmac } from "node:crypto";

import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { ActionDispatcher } from "../src/services/dispatcher.js";
import { verifyWebhookSignature } from "../src/services/security.js";

describe("workspace-ai-workflow-engine", () => {
  it("returns ok from /health", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("classifies an incident webhook and enforces idempotency on duplicate event_id", async () => {
    let sendCalls = 0;
    const dispatcher = new ActionDispatcher(async () => {
      sendCalls += 1;
    });
    const app = createApp({ dispatcher });

    const payload = {
      event_id: "evt-2026-001",
      source: "gcp-monitoring",
      title: "Production outage on Cloud Run billing API",
      body: "500 error spike detected across southamerica-east1 instances.",
      requester: "alert-bot",
    };

    const first = await request(app).post("/webhooks/events").send(payload);
    expect(first.status).toBe(202);
    expect(first.body.duplicate).toBe(false);
    expect(first.body.record.triage.category).toBe("incident");
    expect(first.body.record.triage.priority).toBe("critical");
    expect(first.body.record.triage.target_queue).toBe("sre-oncall");

    // Replaying the same event_id must NOT trigger downstream dispatch again.
    const second = await request(app).post("/webhooks/events").send(payload);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(sendCalls).toBe(1);
  });

  it("retries transient downstream failures with exponential backoff", async () => {
    let attempts = 0;
    const flakyDispatcher = new ActionDispatcher(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("Temporary 503 from downstream webhook");
        }
      },
      3,
      5,
    );
    const app = createApp({ dispatcher: flakyDispatcher });

    const res = await request(app).post("/webhooks/events").send({
      event_id: "evt-2026-002",
      source: "jira",
      title: "Request BigQuery IAM read access",
      body: "Analyst needs read-only access to the analytics dataset.",
      requester: "matheus.joia",
    });

    expect(res.status).toBe(202);
    expect(res.body.record.dispatch.attempts).toBe(3);
    expect(res.body.record.triage.category).toBe("access-request");
  });

  it("rejects requests with invalid HMAC signature when WEBHOOK_SECRET is set", async () => {
    const secret = "super-secret-key";
    const app = createApp({ webhookSecret: secret });
    const payload = {
      event_id: "evt-2026-003",
      source: "google-workspace",
      title: "Automate Google Sheets report sync",
      body: "Need a Workspace workflow to sync weekly KPIs into BigQuery.",
      requester: "ops-team",
    };

    const unauthorized = await request(app).post("/webhooks/events").send(payload);
    expect(unauthorized.status).toBe(401);

    const raw = JSON.stringify(payload);
    const validSig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
    expect(verifyWebhookSignature(raw, validSig, secret)).toBe(true);

    const authorized = await request(app)
      .post("/webhooks/events")
      .set("Content-Type", "application/json")
      .set("X-Webhook-Signature", validSig)
      .send(raw);
    expect(authorized.status).toBe(202);
    expect(authorized.body.record.triage.category).toBe("automation");
  });

  it("rejects malformed webhook payloads with 400", async () => {
    const app = createApp();
    const res = await request(app).post("/webhooks/events").send({ event_id: "x" });
    expect(res.status).toBe(400);
  });
});
