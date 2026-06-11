import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { ApiKey } from "./models";
import { logger } from "./logger";

export interface AiMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

type Provider = "groq" | "gemini" | "nvidia";

const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama3-70b-8192", "llama3-8b-8192"];
const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-flash-latest"];
const NVIDIA_MODELS = ["meta/llama-3.3-70b-instruct", "meta/llama3-70b-instruct"];

// Only skip to the next model for model-availability errors.
// Auth errors (invalid key, quota, etc.) should be rethrown immediately.
function isModelNotAvailableError(errMsg: string): boolean {
  const lower = errMsg.toLowerCase();
  const isAuthError =
    lower.includes("api_key_invalid") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes("permission_denied") ||
    lower.includes("permission denied") ||
    lower.includes("authentication") ||
    lower.includes("unauthorized") ||
    lower.includes("quota") ||
    lower.includes("billing") ||
    lower.includes("401") ||
    lower.includes("403");
  const isModelError =
    lower.includes("model not found") ||
    lower.includes("model is not") ||
    lower.includes("not supported for") ||
    lower.includes("does not exist") ||
    lower.includes("deprecated");
  return isModelError && !isAuthError;
}

async function getKeys(provider: Provider) {
  const keys = await ApiKey.find({ provider, enabled: true }).sort({ errorCount: 1, lastUsed: 1 });
  return keys;
}

async function callGroq(apiKey: string, messages: AiMessage[]): Promise<string> {
  const groq = new Groq({ apiKey });
  const filtered = messages.filter((m) => m.role !== "system");
  const system = messages.find((m) => m.role === "system")?.content;

  for (const model of GROQ_MODELS) {
    try {
      type GMsg = { role: "system" | "user" | "assistant"; content: string };
      const msgs: GMsg[] = system
        ? [{ role: "system", content: system }, ...filtered.map(m => ({ role: m.role as "user" | "assistant", content: m.content }))]
        : filtered.map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
      const completion = await groq.chat.completions.create({
        model,
        messages: msgs,
        max_tokens: 512,
        temperature: 0.9,
      });
      return completion.choices[0]?.message?.content ?? "";
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (isModelNotAvailableError(errMsg)) continue;
      throw err;
    }
  }
  throw new Error("All Groq models failed");
}

async function callGemini(apiKey: string, messages: AiMessage[]): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const system = messages.find((m) => m.role === "system")?.content;
  const filtered = messages.filter((m) => m.role !== "system");

  for (const modelName of GEMINI_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        ...(system ? { systemInstruction: system } : {}),
      });
      const history = filtered.slice(0, -1).map((m) => ({
        role: m.role === "user" ? "user" : "model",
        parts: [{ text: m.content }],
      }));
      const chat = model.startChat({ history });
      const lastMsg = filtered[filtered.length - 1];
      const result = await chat.sendMessage(lastMsg?.content ?? "");
      return result.response.text();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (isModelNotAvailableError(errMsg)) continue;
      throw err;
    }
  }
  throw new Error("All Gemini models failed");
}

async function callNvidia(apiKey: string, messages: AiMessage[]): Promise<string> {
  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: NVIDIA_MODELS[0],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: 512,
      temperature: 0.9,
    }),
  });
  if (!response.ok) {
    throw new Error(`Nvidia API error: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? "";
}

const callFns: Record<Provider, (key: string, messages: AiMessage[]) => Promise<string>> = {
  groq: callGroq,
  gemini: callGemini,
  nvidia: callNvidia,
};

export async function getAiResponse(
  messages: AiMessage[],
  preferredProvider: Provider = "groq"
): Promise<string> {
  const providers: Provider[] = [preferredProvider, ...["groq", "gemini", "nvidia"].filter(
    (p) => p !== preferredProvider
  ) as Provider[]];

  for (const provider of providers) {
    const keys = await getKeys(provider);
    if (keys.length === 0) continue;

    for (const keyDoc of keys) {
      try {
        const result = await callFns[provider](keyDoc.key, messages);
        // Mark successful use
        await ApiKey.findByIdAndUpdate(keyDoc._id, { lastUsed: new Date() });
        return result;
      } catch (err) {
        logger.warn({ err, provider, keyId: keyDoc._id }, "API key failed, trying next");
        await ApiKey.findByIdAndUpdate(keyDoc._id, { $inc: { errorCount: 1 } });
      }
    }
  }

  // Fallback: try env vars directly
  const envGroqKey = process.env.GROQ_API_KEY_1;
  if (envGroqKey) {
    try {
      return await callGroq(envGroqKey, messages);
    } catch (err) {
      logger.error({ err }, "Fallback Groq key also failed");
    }
  }

  throw new Error("All AI providers failed. Please add API keys in the dashboard.");
}
