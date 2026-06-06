import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve dashboard static files
// __dirname = artifacts/api-server/dist/ at runtime, so ../../dashboard reaches artifacts/dashboard/
// Resolve dashboard path — try several locations so it works in dev, Pterodactyl, and Render
const dashboardPath = (() => {
  if (process.env.DASHBOARD_STATIC_PATH) return process.env.DASHBOARD_STATIC_PATH;
  const candidates = [
    path.resolve(__dirname, "../../dashboard/dist/public"),          // dev / Pterodactyl (relative to dist/)
    path.resolve(process.cwd(), "artifacts/dashboard/dist/public"),  // Render (repo root as cwd)
    path.resolve(process.cwd(), "dashboard-dist"),                   // Pterodactyl single-file bundle
  ];
  return candidates.find(fs.existsSync) ?? candidates[0];
})();

// Redirect bare root to the portal so users aren't greeted with a 404
app.get("/", (_req, res) => res.redirect("/portal"));

if (fs.existsSync(dashboardPath)) {
  app.use(express.static(dashboardPath));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(dashboardPath, "index.html"));
  });
  logger.info({ dashboardPath }, "Serving dashboard static files");
} else {
  logger.warn(
    { dashboardPath },
    "Dashboard static files not found — run the build first",
  );
}

export default app;
