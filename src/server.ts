import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 8080);
const app = createApp({
  geminiApiKey: process.env.GEMINI_API_KEY || undefined,
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  webhookSecret: process.env.WEBHOOK_SECRET || undefined,
});

app.listen(port, "0.0.0.0", () => {
  console.log(`workspace-ai-workflow-engine listening on http://localhost:${port}`);
});
