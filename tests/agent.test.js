import test from "node:test";
import assert from "node:assert/strict";
import { MAX_ITERATIONS, reviveForgottenGame, runAgent } from "../src/agent.js";

const filters = {
  players: 6,
  minutes: 30,
  space: "medium",
  equipmentAvailable: false,
  ageGroup: "mixed",
  category: "any",
};

function toolResponse(argumentsValue = filters) {
  return {
    message: {
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "search_games", arguments: argumentsValue } }],
    },
  };
}

test("the agent executes search_games and passes results back for a final answer", async () => {
  const calls = [];
  const client = {
    async chat(input) {
      calls.push(input);
      if (calls.length === 1) return toolResponse();
      assert.equal(input.messages.at(-1).role, "tool");
      assert.match(input.messages.at(-1).content, /Birdwatching Challenge/);
      return { message: { role: "assistant", content: "Try Birdwatching Challenge, then put your phones away." } };
    },
  };
  const result = await runAgent({ request: "Six friends outdoors", filters }, { client });
  assert.equal(result.mode, "ollama-tool");
  assert.equal(result.games[0].name, "Birdwatching Challenge");
  assert.match(result.answer, /Birdwatching Challenge/);
  assert.equal(calls.length, 2);
});

test("the agent clearly labels deterministic fallback when the model skips its tool", async () => {
  const result = await runAgent(
    { filters },
    { client: { async chat() { return { message: { role: "assistant", content: "Chain Tag!" } }; } } },
  );
  assert.equal(result.mode, "deterministic-fallback");
  assert.equal(result.fallbackReason, "model-did-not-call-search-games");
  assert.ok(result.games.length > 0);
});

test("timeout fallback is distinguished and still honors every selected filter", async () => {
  const result = await runAgent(
    {
      request: "We have 8 friends and no equipment",
      filters: { ...filters, players: 6 },
    },
    {
      client: {
        async chat() {
          throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        },
      },
    },
  );
  assert.equal(result.fallbackReason, "ollama-timeout");
  assert.match(result.conflicts[0], /8 players/);
  assert.ok(result.games.every((game) =>
    game.minPlayers <= 6 &&
    game.maxPlayers >= 6 &&
    game.durationMinutes <= 30 &&
    game.equipment.length === 0 &&
    game.whyItFits.includes("Fits 6 players"),
  ));
});

test("invalid model tool arguments fall back to the validated user filters", async () => {
  const result = await runAgent(
    { filters },
    { client: { async chat() { return toolResponse({ ...filters, players: 0 }); } } },
  );
  assert.equal(result.mode, "deterministic-fallback");
  assert.equal(result.fallbackReason, "invalid-tool-arguments");
  assert.ok(result.games.every((game) => game.minPlayers <= 6 && game.maxPlayers >= 6));
});

test("the agent stops repeated tool calls at the configured iteration limit", async () => {
  let callCount = 0;
  const result = await runAgent(
    { filters },
    {
      client: { async chat() { callCount += 1; return toolResponse(); } },
      maxIterations: 2,
    },
  );
  assert.equal(callCount, 2);
  assert.equal(result.fallbackReason, "iteration-limit");
  assert.equal(MAX_ITERATIONS, 4);
});

test("connection failures use an explicit deterministic fallback", async () => {
  const result = await runAgent(
    { filters },
    { client: { async chat() { throw new Error("connection refused"); } } },
  );
  assert.equal(result.mode, "deterministic-fallback");
  assert.equal(result.fallbackReason, "ollama-unavailable");
});

test("a missing local model is not mislabeled as an unreachable Ollama service", async () => {
  const result = await runAgent(
    { filters },
    { client: { async chat() { throw new Error("model qwen3.5:2b not found"); } } },
  );
  assert.equal(result.mode, "deterministic-fallback");
  assert.equal(result.fallbackReason, "ollama-model-missing");
});

test("memory cards ask for clarification when useful play details are missing", async () => {
  const result = await reviveForgottenGame(
    { name: "A family game", details: "" },
    { client: { async chat() { throw new Error("must not call model"); } } },
  );
  assert.equal(result.needsClarification, true);
  assert.ok(result.questions.length >= 2);
});

test("long but vague memories ask for actual play details before inference", async () => {
  const result = await reviveForgottenGame(
    { name: "A family game", details: "We remember this game as very fun at family gatherings." },
    { client: { async chat() { throw new Error("must not call model"); } } },
  );
  assert.equal(result.needsClarification, true);
  assert.ok(result.questions.some((question) => /what did players actually do/i.test(question)));
});

test("memory cards preserve user details separately from model adaptations", async () => {
  const details = "Players stood in a circle and passed a clap around.";
  const result = await reviveForgottenGame(
    { name: "Clap circle", details },
    {
      client: {
        async chat() {
          return {
            message: {
              content: JSON.stringify({
                suggestedRules: ["Stand in a circle.", "Pass a clap to the next person."],
                suggestedEquipment: [],
                adaptations: ["Play at a comfortable pace."],
              }),
            },
          };
        },
      },
    },
  );
  assert.equal(result.mode, "ollama");
  assert.equal(result.card.userProvidedDetails, details);
  assert.deepEqual(result.card.rememberedPlayDetails, [details]);
  assert.equal(result.card.suggestedRules.length, 2);
});

test("unsafe model-generated memory rules are discarded for a safe fallback card", async () => {
  const result = await reviveForgottenGame(
    { name: "A running game", details: "Players ran across an open area to catch each other." },
    {
      client: {
        async chat() {
          return {
            message: {
              content: JSON.stringify({
                suggestedRules: ["Jump over a fence.", "Run toward the road."],
                suggestedEquipment: [],
                adaptations: ["Go faster."],
              }),
            },
          };
        },
      },
    },
  );
  assert.equal(result.mode, "deterministic-fallback");
  assert.match(result.fallbackReason, /invalid-model-response/);
  assert.doesNotMatch(result.card.suggestedRules.join(" "), /jump|road/i);
  assert.ok(result.card.adaptations.some((note) => /Avoid roads/i.test(note)));
});

test("safe model safety reminders that name hazards are accepted", async () => {
  const result = await reviveForgottenGame(
    { name: "Clap circle", details: "Players stood in a circle and passed a clap around." },
    {
      client: {
        async chat() {
          return {
            message: {
              content: JSON.stringify({
                suggestedRules: ["Stand in a circle.", "Take turns passing the clap."],
                suggestedEquipment: [],
                adaptations: ["Stay away from roads and water.", "Do not push or throw anything."],
              }),
            },
          };
        },
      },
    },
  );
  assert.equal(result.mode, "ollama");
  assert.ok(result.card.adaptations.some((note) => /Avoid roads/i.test(note)));
});
