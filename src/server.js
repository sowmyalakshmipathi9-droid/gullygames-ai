import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL, reviveForgottenGame, runAgent } from "./agent.js";
import { CATEGORIES, games } from "./data/games.js";
import {
  validateExcludedIds,
  validateSearchFilters,
} from "./tools/game-library.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const maxBodyBytes = 32 * 1024;
const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readJsonBody(request) {
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > maxBodyBytes) throw new HttpError(413, "Request body is too large.");

  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBodyBytes) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Expected an object.");
    }
    return body;
  } catch {
    throw new HttpError(400, "Request body must be a valid JSON object.");
  }
}

function validateRecommendation(body) {
  const filters = validateSearchFilters(body);
  if (body.request !== undefined && (typeof body.request !== "string" || body.request.length > 500)) {
    throw new TypeError("request must be text no longer than 500 characters.");
  }
  return {
    request: body.request?.trim() ?? "",
    filters,
    excludeIds: validateExcludedIds(body.excludeIds ?? []),
  };
}

function validateRevive(body) {
  if (body.name !== undefined && (typeof body.name !== "string" || body.name.length > 100)) {
    throw new TypeError("name must be text no longer than 100 characters.");
  }
  if (body.details !== undefined && (typeof body.details !== "string" || body.details.length > 1500)) {
    throw new TypeError("details must be text no longer than 1500 characters.");
  }
  const name = body.name?.trim() ?? "";
  const details = body.details?.trim() ?? "";
  if (!name && !details) throw new TypeError("Enter a game name or a description of how it was played.");
  return { name, details };
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

async function ollamaStatus() {
  const host = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/+$/, "");
  try {
    const response = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
    const data = await response.json();
    const modelAvailable = Array.isArray(data.models) &&
      data.models.some((model) => model.name === MODEL || model.name?.startsWith(`${MODEL}:`));
    return {
      available: true,
      model: MODEL,
      modelAvailable,
      message: modelAvailable ? "Ollama and the configured model are ready." : "Ollama is running, but the configured model is not installed.",
    };
  } catch {
    return {
      available: false,
      model: MODEL,
      modelAvailable: false,
      message: "Ollama is not reachable; recommendations will use deterministic search.",
    };
  }
}

export function createServer({ agent = runAgent, revive = reviveForgottenGame } = {}) {
  return createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, { status: "ok", server: "available", ollama: await ollamaStatus() });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/games") {
        sendJson(response, 200, { games, categories: CATEGORIES });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/recommend") {
        const body = await readJsonBody(request);
        let input;
        try {
          input = validateRecommendation(body);
        } catch (error) {
          if (error instanceof TypeError) throw new HttpError(400, error.message);
          throw error;
        }
        sendJson(response, 200, await agent(input));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/revive") {
        const body = await readJsonBody(request);
        let input;
        try {
          input = validateRevive(body);
        } catch (error) {
          if (error instanceof TypeError) throw new HttpError(400, error.message);
          throw error;
        }
        sendJson(response, 200, await revive(input));
        return;
      }
      if (request.method === "GET" && staticFiles[url.pathname]) {
        const [file, contentType] = staticFiles[url.pathname];
        const content = await readFile(join(root, "public", file));
        response.writeHead(200, {
          "content-type": contentType,
          "x-content-type-options": "nosniff",
        });
        response.end(content);
        return;
      }
      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(`Request failed: ${error.message}`);
      sendJson(response, status, {
        error: status === 500 ? "The request could not be completed." : error.message,
      });
    }
  });
}
