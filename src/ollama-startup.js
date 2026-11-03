import { spawn } from "node:child_process";

const defaultHost = "http://127.0.0.1:11434";

function isLocalOllamaHost(host) {
  try {
    const url = new URL(host);
    return (
      ["127.0.0.1", "localhost", "::1"].includes(url.hostname) &&
      url.port === "11434"
    );
  } catch {
    return false;
  }
}

async function isReachable(host, fetchImpl) {
  try {
    const response = await fetchImpl(`${host.replace(/\/+$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ensureLocalOllama({
  host = process.env.OLLAMA_HOST || defaultHost,
  fetchImpl = fetch,
  spawnImpl = spawn,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  log = (message) => console.log(message),
  warn = (message) => console.warn(message),
} = {}) {
  if (await isReachable(host, fetchImpl)) return true;
  if (!isLocalOllamaHost(host)) {
    warn(`Ollama is not reachable at ${host}; the app will use library fallback.`);
    return false;
  }

  log("Local Ollama is not running; trying to start `ollama serve`.");
  let startupError;
  let child;
  try {
    child = spawnImpl("ollama", ["serve"], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", (error) => {
      startupError = error;
    });
  } catch (error) {
    startupError = error;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await isReachable(host, fetchImpl)) {
      log("Local Ollama is ready.");
      return true;
    }
    if (startupError || child?.exitCode !== null && child?.exitCode !== undefined) break;
    await wait(500);
  }

  warn(
    startupError
      ? `Could not start local Ollama (${startupError.message}); the app will use library fallback.`
      : "Local Ollama did not become ready; the app will use library fallback.",
  );
  return false;
}
