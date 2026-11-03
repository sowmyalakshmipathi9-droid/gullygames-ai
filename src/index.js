import { createServer } from "./server.js";
import { ensureLocalOllama } from "./ollama-startup.js";

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new TypeError("PORT must be an integer between 1 and 65535.");
}

await ensureLocalOllama();

const server = createServer();
server.listen(port, "0.0.0.0", () => {
  console.log(`GullyGames AI is ready at http://0.0.0.0:${port}`);
  console.log("Ollama model: qwen3.5:2b (deterministic fallback is available)");
});
server.on("error", (error) => {
  console.error(`Could not start the GullyGames server: ${error.message}`);
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
