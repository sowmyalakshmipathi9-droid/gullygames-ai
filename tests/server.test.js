import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";

const validBody = {
  players: 6,
  minutes: 30,
  space: "medium",
  equipmentAvailable: false,
  ageGroup: "mixed",
  category: "any",
  request: "A fun park game",
};

async function withServer(server, callback) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("recommendation API validates incoming preferences before calling the agent", async () => {
  let agentCalls = 0;
  const server = createServer({
    agent: async () => {
      agentCalls += 1;
      return { games: [] };
    },
  });
  await withServer(server, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/recommend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, players: 0 }),
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /players/);
    assert.equal(agentCalls, 0);

    const valid = await fetch(`${baseUrl}/api/recommend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    assert.equal(valid.status, 200);
    assert.equal(agentCalls, 1);
  });
});

test("unexpected recommendation API failures return 500 rather than input errors", async () => {
  const server = createServer({
    agent: async () => {
      throw new TypeError("internal model response issue");
    },
  });
  await withServer(server, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/recommend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "The request could not be completed." });
  });
});

test("the server exposes the library and safely serves the app", async () => {
  const server = createServer({
    agent: async () => ({ games: [] }),
  });
  await withServer(server, async (baseUrl) => {
    const libraryResponse = await fetch(`${baseUrl}/api/games`);
    assert.equal(libraryResponse.status, 200);
    assert.ok((await libraryResponse.json()).games.length >= 15);

    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /GullyGames AI/);
    assert.match(html, /name="players"/);
    assert.match(html, /name="equipmentAvailable"/);
    assert.match(html, /name="category"/);
    assert.match(html, /id="find-button"/);

    const app = await fetch(`${baseUrl}/app.js`);
    assert.equal(app.status, 200);
    assert.match(await app.text(), /Rules & safety/);

    const invalidJson = await fetch(`${baseUrl}/api/recommend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    assert.equal(invalidJson.status, 400);
  });
});

test("memory endpoint validates missing input and asks for clarification", async () => {
  const server = createServer({
    agent: async () => ({ games: [] }),
    revive: async () => ({ needsClarification: true, questions: ["What happened in a round?"] }),
  });
  await withServer(server, async (baseUrl) => {
    const empty = await fetch(`${baseUrl}/api/revive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(empty.status, 400);

    const partial = await fetch(`${baseUrl}/api/revive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "A game" }),
    });
    assert.equal(partial.status, 200);
    assert.equal((await partial.json()).needsClarification, true);
  });
});
