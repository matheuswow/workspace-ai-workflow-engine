import { GoogleGenAI, Type } from "@google/genai";

import { TriageResultSchema, type TriageResult, type WebhookEvent } from "../schemas.js";

export interface ClassificationOutput {
  triage: TriageResult;
  model: string;
}

export class EventClassifier {
  private readonly client: GoogleGenAI | null;
  private readonly model: string;

  constructor(apiKey?: string, model = "gemini-2.5-flash") {
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
    this.model = model;
  }

  async classify(event: WebhookEvent): Promise<ClassificationOutput> {
    if (this.client) {
      return this.classifyWithGemini(event);
    }
    return {
      triage: this.classifyLocally(event),
      model: "local-deterministic-classifier",
    };
  }

  private async classifyWithGemini(event: WebhookEvent): Promise<ClassificationOutput> {
    if (!this.client) {
      throw new Error("Gemini client not initialized.");
    }

    const prompt = [
      "Classify and summarize the following enterprise webhook event.",
      `Source: ${event.source}`,
      `Title: ${event.title}`,
      `Body: ${event.body}`,
      `Requester: ${event.requester}`,
    ].join("\n");

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            category: {
              type: Type.STRING,
              enum: ["incident", "access-request", "automation", "general"],
            },
            priority: {
              type: Type.STRING,
              enum: ["low", "medium", "high", "critical"],
            },
            summary: { type: Type.STRING },
            target_queue: { type: Type.STRING },
          },
          required: ["category", "priority", "summary", "target_queue"],
        },
      },
    });

    const parsed = TriageResultSchema.parse(JSON.parse(response.text ?? "{}"));
    return { triage: parsed, model: this.model };
  }

  private classifyLocally(event: WebhookEvent): TriageResult {
    const text = `${event.title} ${event.body}`.toLowerCase();

    let category: TriageResult["category"] = "general";
    let targetQueue = "it-service-desk";

    if (/(outage|down|500|error|crash|failed|falha|fora do ar)/.test(text)) {
      category = "incident";
      targetQueue = "sre-oncall";
    } else if (/(access|iam|permission|role|acesso|permiss)/.test(text)) {
      category = "access-request";
      targetQueue = "cloud-iam-ops";
    } else if (/(automate|workflow|workspace|sheet|drive|gemini)/.test(text)) {
      category = "automation";
      targetQueue = "workspace-engineering";
    }

    let priority: TriageResult["priority"] = "medium";
    if (/(critical|sev1|production down|outage|fora do ar)/.test(text)) {
      priority = "critical";
    } else if (/(urgent|high|blocking|urgente|error)/.test(text)) {
      priority = "high";
    } else if (/(question|info|minor|dúvida)/.test(text)) {
      priority = "low";
    }

    const summary = `[${event.source}] ${event.title.trim()} (requester: ${event.requester})`;
    return {
      category,
      priority,
      summary: summary.slice(0, 300),
      target_queue: targetQueue,
    };
  }
}
