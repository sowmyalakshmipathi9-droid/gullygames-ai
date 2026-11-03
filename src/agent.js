import { Ollama } from "ollama";
import {
  AGE_GROUPS,
  explainGameFit,
  findPreferenceConflicts,
  searchGames,
  validateSearchFilters,
} from "./tools/game-library.js";
import { CATEGORIES } from "./data/games.js";

export const MODEL = "qwen3.5:2b";
export const MAX_ITERATIONS = 4;
const MAX_TOOL_CALLS = 8;
const INFERENCE_TIMEOUT_MS = 180_000;

const timeoutFetch = (input, init) => {
  const signals = [AbortSignal.timeout(INFERENCE_TIMEOUT_MS)];
  if (init?.signal) signals.push(init.signal);
  return fetch(input, { ...init, signal: AbortSignal.any(signals) });
};

const defaultClient = new Ollama({
  host: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
  fetch: timeoutFetch,
});

const searchTool = {
  type: "function",
  function: {
    name: "search_games",
    description:
      "Search curated games using the exact filters supplied by the user.",
    parameters: {
      type: "object",
      required: ["players", "minutes", "space", "equipmentAvailable", "ageGroup", "category"],
      properties: {
        players: { type: "integer", description: "Exact number of players" },
        minutes: { type: "integer", description: "Maximum available minutes" },
        space: { type: "string", enum: ["small", "medium", "large"] },
        equipmentAvailable: { type: "boolean" },
        ageGroup: { type: "string", enum: AGE_GROUPS },
        category: { type: "string", enum: ["any", ...CATEGORIES] },
      },
    },
  },
};

function sameFilters(left, right) {
  return Object.keys(right).every((key) => left[key] === right[key]);
}

function fallbackRecommendation(filters, excludeIds, reason, conflicts = []) {
  const result = searchGames(filters, excludeIds);
  const answer = result.count
    ? `Here are ${result.count} safe, practical option${result.count === 1 ? "" : "s"} from the game library. Choose the one your group likes, agree on the boundaries, then put the phone away.`
    : result.message;

  return {
    answer,
    games: result.matches.slice(0, 3).map((game) => ({
      ...game,
      whyItFits: explainGameFit(game, filters),
    })),
    suggestions: result.suggestions,
    message: result.message,
    mode: "deterministic-fallback",
    fallbackReason: reason,
    conflicts,
  };
}

function modelToolResult(result) {
  return {
    count: result.count,
    message: result.message,
    matches: result.matches.slice(0, 3).map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
    suggestions: result.suggestions.map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
  };
}

export async function runAgent(
  { request = "", filters: rawFilters, excludeIds = [] },
  { client = defaultClient, maxIterations = MAX_ITERATIONS } = {},
) {
  const filters = validateSearchFilters(rawFilters);
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_ITERATIONS) {
    throw new TypeError(`maxIterations must be between 1 and ${MAX_ITERATIONS}.`);
  }

  const messages = [
    {
      role: "system",
      content:
        "You are GullyGames AI, a friendly outdoor game guide. Before recommending any game, call search_games. Preserve the selected player count, time, space, equipment, age, and category filters exactly; these selections take priority over any conflicting free-text request. After tool results, recommend only a game shown in matches, using its exact name; if matches is empty, say so and use only the provided suggestions. Never invent game information. Keep safety advice practical and remind the group to put phones away.",
    },
    {
      role: "user",
      content: `Free-text request (context only; do not override selected filters): ${request || "No additional request."}\nAuthoritative selected filters: ${JSON.stringify(filters)}`,
    },
  ];
  const conflicts = findPreferenceConflicts(request, filters);
  let toolCalls = 0;
  let lastSearch = null;

  try {
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const response = await client.chat({
        model: MODEL,
        messages,
        tools: [searchTool],
        think: false,
        keep_alive: "10m",
        options: { temperature: 0.2, num_predict: 96, num_ctx: 4096 },
      });
      const message = response?.message;
      if (!message || typeof message.content !== "string") {
        return fallbackRecommendation(filters, excludeIds, "invalid-model-response", conflicts);
      }
      messages.push(message);

      const calls = message.tool_calls ?? [];
      if (!calls.length) {
        if (!lastSearch) {
          return fallbackRecommendation(filters, excludeIds, "model-did-not-call-search-games", conflicts);
        }
        if (!lastSearch.count) {
          return {
            answer: lastSearch.message,
            games: [],
            suggestions: lastSearch.suggestions,
            message: lastSearch.message,
            mode: "ollama-tool",
            conflicts,
          };
        }
        const modelText = message.content.trim().toLocaleLowerCase();
        const selectedGame = lastSearch.matches.slice(0, 3).find((game) =>
          modelText.includes(game.name.toLocaleLowerCase()),
        );
        if (!selectedGame) {
          return fallbackRecommendation(filters, excludeIds, "model-did-not-select-library-game", conflicts);
        }
        const recommendations = [
          selectedGame,
          ...lastSearch.matches.filter((game) => game.id !== selectedGame.id),
        ].slice(0, 3);
        return {
          answer: `${selectedGame.name} looks like a good fit: ${selectedGame.description}`,
          games: recommendations.map((game) => ({
            ...game,
            whyItFits: explainGameFit(game, filters),
          })),
          suggestions: [],
          message: lastSearch.message,
          mode: "ollama-tool",
          selectedGameId: selectedGame.id,
          conflicts,
        };
      }

      toolCalls += calls.length;
      if (toolCalls > MAX_TOOL_CALLS) {
        return fallbackRecommendation(filters, excludeIds, "tool-call-limit", conflicts);
      }

      for (const call of calls) {
        if (call?.function?.name !== "search_games") {
          return fallbackRecommendation(filters, excludeIds, "unsupported-tool", conflicts);
        }
        const argumentKeys = Object.keys(call.function.arguments ?? {}).sort();
        const expectedKeys = Object.keys(filters).sort();
        if (
          argumentKeys.length !== expectedKeys.length ||
          argumentKeys.some((key, index) => key !== expectedKeys[index])
        ) {
          return fallbackRecommendation(filters, excludeIds, "invalid-tool-arguments", conflicts);
        }
        let toolFilters;
        try {
          toolFilters = validateSearchFilters(call.function.arguments);
        } catch {
          return fallbackRecommendation(filters, excludeIds, "invalid-tool-arguments", conflicts);
        }
        if (!sameFilters(toolFilters, filters)) {
          return fallbackRecommendation(filters, excludeIds, "tool-arguments-did-not-match-request", conflicts);
        }
        lastSearch = searchGames(toolFilters, excludeIds);
        messages.push({
          role: "tool",
          tool_name: "search_games",
          content: JSON.stringify(modelToolResult(lastSearch)),
        });
      }
    }
  } catch (error) {
    const reason = /timeout|timed out|aborted/i.test(error.message)
      ? "ollama-timeout"
      : /model .{0,80}not found|model not found/i.test(error.message)
        ? "ollama-model-missing"
        : "ollama-unavailable";
    console.warn(`GullyGames used deterministic fallback (${reason}): ${error.message}`);
    return fallbackRecommendation(filters, excludeIds, reason, conflicts);
  }

  if (lastSearch) {
    return fallbackRecommendation(filters, excludeIds, "iteration-limit", conflicts);
  }
  return fallbackRecommendation(filters, excludeIds, "model-did-not-call-search-games", conflicts);
}

function stringList(value, limit = 6) {
  return Array.isArray(value) &&
    value.length <= limit &&
    value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 240);
}

const unsafeSuggestionPattern =
  /\b(?:roads?|traffic|rivers?|lakes?|pools?|water|cliffs?|roofs?|heights?|climbing|climb|jumping|jump|throwing|throw|tossing|toss|kicking|kick|hitting|hit|punching|punch|tackling|tackle|pushing|push|shoving|shove|fighting|fight|weapons?|fire|blindfold(?:ed)?|faces?|heads?)\b/gi;
const safetyNegationPattern =
  /\b(?:avoid|never|no|not|without|don't|do not|stay away from|keep away from|stay clear of|keep clear of|away from)\b[^.!?;]*$/i;

function containsUnsafeSuggestion(value) {
  return value.split(/[.!?;]/).some((clause) =>
    [...clause.matchAll(unsafeSuggestionPattern)].some(({ index }) =>
      !safetyNegationPattern.test(clause.slice(0, index)),
    ),
  );
}

export async function reviveForgottenGame({ name, details }, { client = defaultClient } = {}) {
  const gameName = name.trim().slice(0, 100) || "Remembered game";
  const rememberedDetails = details.trim().slice(0, 1500);
  const includesPlayAction =
    /\b(?:stand|stands|standing|stood|sit|sits|sitting|sat|walk|walks|walking|walked|run|runs|running|ran|tag|tags|tagged|chase|chases|chasing|catch|catches|caught|clap|claps|clapped|clapping|pass|passes|passed|passing|count|counts|counted|hide|hides|hid|seek|seeks|dance|dances|danced|sing|sings|sang|guess|guesses|guessed|pick|picks|picked|find|finds|found|follow|follows|followed|copy|copies|copied|move|moves|moved|jump|jumps|jumped|race|races|raced|roll|rolls|rolled|stack|stacks|stacked|build|builds|built|point|points|pointed|turns)\b/i.test(
      rememberedDetails,
    );
  if (rememberedDetails.length < 20 || !includesPlayAction) {
    return {
      needsClarification: true,
      questions: [
        "What did players actually do during a round?",
        "How many people played, and what equipment (if any) did you use?",
      ],
    };
  }

  const base = {
    needsClarification: false,
    card: {
      name: gameName,
      userProvidedDetails: rememberedDetails,
      rememberedPlayDetails: rememberedDetails
        .split(/(?<=[.!?])\s+/)
        .filter(Boolean)
        .slice(0, 8),
      suggestedRules: [
        "Use the remembered play details as the starting sequence; anything not remembered is left open.",
        "Before playing, agree together on a clear boundary, who starts, how a round ends, and a no-pressure way to sit out.",
      ],
      suggestedEquipment: [],
      adaptations: [
        "Adapt the pace and space to the people playing and the local conditions.",
        "Avoid roads, water, heights, contact, and throwing objects at people.",
      ],
    },
    mode: "deterministic-fallback",
    fallbackReason: "ollama-unavailable",
  };

  try {
    const response = await client.chat({
      model: MODEL,
      format: "json",
      think: false,
      keep_alive: "10m",
      options: { temperature: 0.2, num_predict: 256, num_ctx: 4096 },
      messages: [
        {
          role: "system",
          content:
            "Create a practical, safe play-card adaptation using only the supplied memory. Never claim historical or cultural authenticity or invent origins. The exact user memory is already preserved separately; do not restate invented facts as memories. Return JSON with suggestedRules (2-5 short strings), suggestedEquipment (0-5 short strings), and adaptations (1-4 short strings). These are suggestions, not verified original rules. Do not include dangerous challenges, roads, water, heights, contact, elimination, forcing a player to sit out, or throwing objects at people. Let players pass or restart without penalty.",
        },
        { role: "user", content: `Game name: ${gameName}\nWhat I remember: ${rememberedDetails}` },
      ],
    });
    let parsed;
    try {
      const content = response?.message?.content;
      if (typeof content !== "string") return { ...base, fallbackReason: "invalid-model-response" };
      parsed = JSON.parse(content);
    } catch {
      return { ...base, fallbackReason: "invalid-model-response" };
    }
    if (
      stringList(parsed.suggestedRules, 5) &&
      parsed.suggestedRules.length >= 2 &&
      stringList(parsed.suggestedEquipment, 5) &&
      stringList(parsed.adaptations, 4) &&
      parsed.adaptations.length >= 1 &&
      ![...parsed.suggestedRules, ...parsed.suggestedEquipment, ...parsed.adaptations]
        .some(containsUnsafeSuggestion)
    ) {
      return {
        ...base,
        card: {
          ...base.card,
          suggestedRules: parsed.suggestedRules,
          suggestedEquipment: parsed.suggestedEquipment,
          adaptations: [...parsed.adaptations, ...base.card.adaptations],
        },
        mode: "ollama",
        fallbackReason: undefined,
      };
    }
    return { ...base, fallbackReason: "invalid-model-response" };
  } catch (error) {
    const reason = /timeout|timed out|aborted/i.test(error.message)
      ? "ollama-timeout"
      : /model .{0,80}not found|model not found/i.test(error.message)
        ? "ollama-model-missing"
        : "ollama-unavailable";
    console.warn(`GullyGames used a basic memory card (${reason}): ${error.message}`);
    return { ...base, fallbackReason: reason };
  }
}
