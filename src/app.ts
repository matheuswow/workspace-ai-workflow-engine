import express, { type Express, type Request, type Response } from "express";

import { WebhookEventSchema, type WorkflowExecutionRecord } from "./schemas.js";
import { EventClassifier } from "./services/classifier.js";
import { ActionDispatcher } from "./services/dispatcher.js";
import { IdempotencyStore } from "./services/idempotency.js";
import { verifyWebhookSignature } from "./services/security.js";

export interface AppConfig {
  geminiApiKey?: string;
  geminiModel?: string;
  webhookSecret?: string;
  dispatcher?: ActionDispatcher;
  store?: IdempotencyStore;
}

interface RawBodyRequest extends Request {
  rawBody?: string;
}

export function createApp(config: AppConfig = {}): Express {
  const app = express();
  const store = config.store ?? new IdempotencyStore();
  const classifier = new EventClassifier(config.geminiApiKey, config.geminiModel);
  const dispatcher = config.dispatcher ?? new ActionDispatcher();

  app.use(
    express.json({
      limit: "256kb",
      verify: (req: RawBodyRequest, _res, buf) => {
        req.rawBody = buf.toString("utf8");
      },
    }),
  );

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      gemini_enabled: Boolean(config.geminiApiKey),
      signature_required: Boolean(config.webhookSecret),
    });
  });

  app.get("/events", (_req: Request, res: Response) => {
    res.json({ count: store.list().length, events: store.list() });
  });

  app.post("/webhooks/events", async (req: RawBodyRequest, res: Response) => {
    if (config.webhookSecret) {
      const signature = req.header("x-webhook-signature");
      const raw = req.rawBody ?? JSON.stringify(req.body ?? {});
      if (!verifyWebhookSignature(raw, signature, config.webhookSecret)) {
        res.status(401).json({ error: "Invalid webhook signature" });
        return;
      }
    }

    const parsed = WebhookEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid webhook payload",
        details: parsed.error.flatten(),
      });
      return;
    }

    const event = parsed.data;
    const existing = store.get(event.event_id);
    if (existing) {
      res.status(200).json({ duplicate: true, record: existing });
      return;
    }

    try {
      const { triage, model } = await classifier.classify(event);
      const dispatch = await dispatcher.dispatch(event, triage);

      const record: WorkflowExecutionRecord = {
        event_id: event.event_id,
        source: event.source,
        triage,
        dispatch,
        model,
        processed_at: new Date().toISOString(),
      };

      store.set(event.event_id, record);
      res.status(202).json({ duplicate: false, record });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown processing error";
      res.status(502).json({ error: "Downstream dispatch failed", detail: message });
    }
  });

  return app;
}
