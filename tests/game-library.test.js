import test from "node:test";
import assert from "node:assert/strict";
import { games } from "../src/data/games.js";
import {
  explainGameFit,
  findPreferenceConflicts,
  searchGames,
  validateSearchFilters,
} from "../src/tools/game-library.js";

const baseFilters = {
  players: 6,
  minutes: 30,
  space: "medium",
  equipmentAvailable: false,
  ageGroup: "mixed",
  category: "any",
};

test("the curated library contains at least 15 complete game cards", () => {
  assert.ok(games.length >= 15);
  assert.equal(new Set(games.map((game) => game.id)).size, games.length);
  for (const game of games) {
    assert.ok(game.name && game.description && game.rules.length && game.safety.length);
    assert.ok(game.minPlayers <= game.maxPlayers);
    assert.ok(game.durationMinutes > 0);
    assert.ok(game.suitability && game.categories.length);
  }
});

test("the library includes each game requested for the MVP", () => {
  const expectedNames = [
    "Kho-Kho Lite", "Chain Tag", "Four Corners", "Seven Stones", "Simon Says Outdoors",
    "Follow the Leader", "Nature Scavenger Hunt", "Shadow Tag", "Human Knot", "Circle Games",
    "Red Light, Green Light", "Silent Nature Bingo", "Obstacle-Free Relay", "Story Circle",
    "Birdwatching Challenge",
  ];
  for (const name of expectedNames) assert.ok(games.some((game) => game.name === name), name);
});

test("player count filtering returns only games that support the group", () => {
  const result = searchGames({ ...baseFilters, players: 2 });
  assert.ok(result.matches.length > 0);
  assert.ok(result.matches.every((game) => game.minPlayers <= 2 && game.maxPlayers >= 2));
});

test("time filtering excludes games longer than the available time", () => {
  const result = searchGames({ ...baseFilters, minutes: 10 });
  assert.ok(result.matches.length > 0);
  assert.ok(result.matches.every((game) => game.durationMinutes <= 10));
  assert.equal(result.matches[0].durationMinutes, 10);
});

test("equipment filtering excludes games that require equipment", () => {
  const result = searchGames({ ...baseFilters, equipmentAvailable: false });
  assert.ok(result.matches.length > 0);
  assert.ok(result.matches.every((game) => game.equipment.length === 0));
});

test("available equipment permits otherwise matching games that need it", () => {
  const result = searchGames({
    ...baseFilters,
    players: 8,
    equipmentAvailable: true,
    ageGroup: "9-12",
    category: "traditional",
  });
  assert.ok(result.matches.some((game) => game.id === "seven-stones"));
});

test("space filtering only returns games that fit the available space", () => {
  const result = searchGames({ ...baseFilters, space: "small" });
  assert.ok(result.matches.length > 0);
  assert.ok(result.matches.every((game) => game.spaceRequirement === "small"));
});

test("age filtering requires a game to cover the selected age band", () => {
  const result = searchGames({ ...baseFilters, ageGroup: "under-6", players: 3 });
  assert.ok(result.matches.length > 0);
  assert.ok(result.matches.every((game) => game.minAge <= 4 && game.maxAge >= 5));
});

test("category filtering is deterministic", () => {
  const result = searchGames({ ...baseFilters, category: "nature" });
  assert.ok(result.matches.length > 0);
  assert.ok(result.matches.every((game) => game.categories.includes("nature")));
});

test("find another excludes games already displayed", () => {
  const first = searchGames(baseFilters);
  const previouslyShown = first.matches.slice(0, 3).map((game) => game.id);
  const next = searchGames(baseFilters, previouslyShown);
  assert.ok(next.matches.length > 0);
  assert.ok(next.matches.every((game) => !previouslyShown.includes(game.id)));
});

test("every result satisfies all selected hard constraints together", () => {
  const selected = {
    players: 8,
    minutes: 30,
    space: "medium",
    equipmentAvailable: true,
    ageGroup: "9-12",
    category: "traditional",
  };
  const result = searchGames(selected);
  assert.ok(result.matches.length);
  for (const game of result.matches) {
    assert.ok(game.minPlayers <= selected.players && game.maxPlayers >= selected.players);
    assert.ok(game.durationMinutes <= selected.minutes);
    assert.ok(["small", "medium"].includes(game.spaceRequirement));
    assert.ok(game.minAge <= 9 && game.maxAge >= 12);
    assert.ok(game.categories.includes(selected.category));
  }
});

test("free-text conflicts are reported without changing selected filters", () => {
  const selected = { ...baseFilters, equipmentAvailable: true, space: "large", category: "team" };
  const conflicts = findPreferenceConflicts(
    "We have 8 friends, 15 minutes, no equipment, and want a nature game in a small space.",
    selected,
  );
  assert.equal(conflicts.length, 5);
  assert.match(conflicts[0], /8 players.*selector is set to 6/);
  assert.match(conflicts[1], /15 minutes.*selector is set to 30/);
  assert.ok(conflicts.some((conflict) => /equipment toggle disagree/.test(conflict)));
  assert.ok(conflicts.some((conflict) => /space selector/.test(conflict)));
  assert.ok(conflicts.some((conflict) => /mood selector/.test(conflict)));
  assert.equal(selected.players, 6);
  assert.equal(selected.minutes, 30);
});

test("free-text age conflicts are called out and do not change the selected age group", () => {
  const selected = { ...baseFilters, ageGroup: "13-plus" };
  const conflicts = findPreferenceConflicts("The kids are 5-year-olds.", selected);
  assert.ok(conflicts.some((conflict) => /outside the selected age group/.test(conflict)));
  assert.equal(selected.ageGroup, "13-plus");
});

test("each game fit explanation uses actual selected constraints and game data", () => {
  const game = searchGames(baseFilters).matches[0];
  const explanation = explainGameFit(game, baseFilters);
  assert.match(explanation, /6 players/);
  assert.match(explanation, new RegExp(`${game.durationMinutes} of your 30 available minutes`));
  assert.match(explanation, /mixed ages 6\+/);
  assert.match(explanation, /needs no equipment/);
});

test("empty searches return a clear message and only real fallback games", () => {
  const result = searchGames({ ...baseFilters, players: 100 });
  assert.equal(result.count, 0);
  assert.match(result.message, /No games in the library/);
  assert.deepEqual(result.suggestions, []);
});

test("invalid search tool arguments are rejected", () => {
  assert.throws(() => validateSearchFilters({ ...baseFilters, players: -1 }), /players/);
  assert.throws(() => validateSearchFilters({ ...baseFilters, equipmentAvailable: "no" }), /boolean/);
  assert.throws(() => validateSearchFilters({ ...baseFilters, category: "made-up" }), /category/);
});

test("every game has clear, non-hazardous safety guidance", () => {
  for (const game of games) {
    assert.ok(game.safety.some((note) => note.trim().length > 15), game.name);
    assert.doesNotMatch(`${game.rules.join(" ")} ${game.safety.join(" ")}`, /throw.{0,20}(at|toward).{0,10}(face|head)|push people/i);
  }
});
