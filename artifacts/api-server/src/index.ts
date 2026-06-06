import app from "./app";
import { logger } from "./lib/logger";
import { connectMongoDB } from "./lib/mongodb";
import { initBot } from "./lib/bot";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  try {
    await connectMongoDB();
    logger.info("MongoDB connected");
  } catch (err) {
    logger.error({ err }, "MongoDB connection failed - continuing without it");
  }

  // Seed initial API keys from env vars
  try {
    const { ApiKey } = await import("./lib/models");
    const count = await ApiKey.countDocuments();
    if (count === 0) {
      const keysToSeed = [];
      if (process.env.GROQ_API_KEY_1) {
        keysToSeed.push({ provider: "groq" as const, label: "Groq Key 1", key: process.env.GROQ_API_KEY_1, enabled: true, errorCount: 0 });
      }
      if (process.env.GEMINI_API_KEY_1) {
        keysToSeed.push({ provider: "gemini" as const, label: "Gemini Key 1", key: process.env.GEMINI_API_KEY_1, enabled: true, errorCount: 0 });
      }
      if (process.env.NVIDIA_API_KEY_1) {
        keysToSeed.push({ provider: "nvidia" as const, label: "Nvidia Key 1", key: process.env.NVIDIA_API_KEY_1, enabled: true, errorCount: 0 });
      }
      if (keysToSeed.length > 0) {
        await ApiKey.insertMany(keysToSeed);
        logger.info({ count: keysToSeed.length }, "Seeded API keys from env vars");
      }
    }
  } catch (err) {
    logger.warn({ err }, "Failed to seed API keys");
  }

  app.listen(port, async (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");

    // Init Discord bot after server starts
    try {
      await initBot();
    } catch (err) {
      logger.error({ err }, "Discord bot init failed");
    }
  });
}

start().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
