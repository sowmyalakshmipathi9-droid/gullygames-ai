import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ensureLocalOllama } from "../src/ollama-startup.js";

test("startup leaves a reachable local Ollama service alone", async () => {
  let spawnCount = 0;
  const ready = await ensureLocalOllama({
    host: "http://127.0.0.1:11434",
    fetchImpl: async () => ({ ok: true }),
    spawnImpl: () => {
      spawnCount += 1;
      return new EventEmitter();
    },
  });
  assert.equal(ready, true);
  assert.equal(spawnCount, 0);
});

test("startup launches local Ollama and waits for the API", async () => {
  let requests = 0;
  let command;
  let args;
  const ready = await ensureLocalOllama({
    host: "http://127.0.0.1:11434",
    fetchImpl: async () => {
      requests += 1;
      if (requests < 3) throw new Error("connection refused");
      return { ok: true };
    },
    spawnImpl: (nextCommand, nextArgs) => {
      command = nextCommand;
      args = nextArgs;
      return new EventEmitter();
    },
    wait: async () => {},
    log: () => {},
  });
  assert.equal(ready, true);
  assert.equal(command, "ollama");
  assert.deepEqual(args, ["serve"]);
});

test("startup does not spawn a local daemon for an unreachable remote host", async () => {
  let spawnCount = 0;
  const warnings = [];
  const ready = await ensureLocalOllama({
    host: "https://ollama.example.test",
    fetchImpl: async () => {
      throw new Error("network failure");
    },
    spawnImpl: () => {
      spawnCount += 1;
      return new EventEmitter();
    },
    warn: (message) => warnings.push(message),
  });
  assert.equal(ready, false);
  assert.equal(spawnCount, 0);
  assert.match(warnings[0], /will use library fallback/);
});

test("startup reports missing Ollama executable without stopping the app", async () => {
  const warnings = [];
  const ready = await ensureLocalOllama({
    host: "http://localhost:11434",
    fetchImpl: async () => {
      throw new Error("connection refused");
    },
    spawnImpl: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", new Error("ollama executable not found")));
      return child;
    },
    wait: async () => {},
    warn: (message) => warnings.push(message),
  });
  assert.equal(ready, false);
  assert.match(warnings[0], /ollama executable not found/);
});
