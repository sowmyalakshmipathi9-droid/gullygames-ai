import { CATEGORIES, games } from "../data/games.js";

export const SPACES = ["small", "medium", "large"];
export const AGE_GROUPS = ["under-6", "6-8", "9-12", "13-plus", "mixed"];

const spaceRank = Object.fromEntries(SPACES.map((space, index) => [space, index]));
const ageBounds = {
  "under-6": [4, 5],
  "6-8": [6, 8],
  "9-12": [9, 12],
  "13-plus": [13, 99],
  mixed: [6, 99],
};

const numberWords = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  sixty: 60,
};

function mentionedNumber(text, units) {
  const unitPattern = units.join("|");
  const match = text.match(new RegExp(`\\b(\\d+|${Object.keys(numberWords).join("|")})\\s*(?:${unitPattern})\\b`, "i"));
  if (!match) return null;
  return Number(match[1]) || numberWords[match[1].toLowerCase()] || null;
}

export function findPreferenceConflicts(request, filters) {
  if (typeof request !== "string" || !request.trim()) return [];
  const text = request.toLowerCase();
  const conflicts = [];
  const players = mentionedNumber(text, ["friends?", "people", "players?", "kids?", "children"]);
  const minutes = mentionedNumber(text, ["minutes?", "mins?"]);
  if (players !== null && players !== filters.players) {
    conflicts.push(`Your description mentions ${players} players, but the player selector is set to ${filters.players}.`);
  }
  if (minutes !== null && minutes !== filters.minutes) {
    conflicts.push(`Your description mentions ${minutes} minutes, but the time selector is set to ${filters.minutes} minutes.`);
  }

  const selectedAgeRange = ageBounds[filters.ageGroup];
  const describedAgeRanges = [
    ...[...text.matchAll(/\b(?:ages?|aged)\s*(\d+)(?:\s*(?:-|–|to)\s*(\d+))?/gi)]
      .map((match) => [Number(match[1]), Number(match[2] ?? match[1])]),
    ...[...text.matchAll(/\b(\d+)\s*(?:-\s*)?years?\s*(?:-\s*|\s+)olds?\b/gi)]
      .map((match) => [Number(match[1]), Number(match[1])]),
  ];
  if (describedAgeRanges.some(([min, max]) => min < selectedAgeRange[0] || max > selectedAgeRange[1])) {
    conflicts.push("Your description mentions ages outside the selected age group; the age selector is being used.");
  }

  const mentionsNoEquipment =
    /\bno (?:equipment|gear|props?)\b|\bwithout (?:any )?(?:equipment|gear|props?)\b|\b(?:don't|do not) have (?:any )?(?:equipment|gear|props?)\b/.test(text);
  const mentionsEquipment = /\b(?:have|using|with)\b.{0,24}\b(?:equipment|gear|ball|balls|cones|markers|rope|ropes|chalk)\b/.test(text);
  if (
    (mentionsNoEquipment && filters.equipmentAvailable) ||
    (mentionsEquipment && !mentionsNoEquipment && !filters.equipmentAvailable)
  ) {
    conflicts.push(`Your description and equipment toggle disagree; the equipment toggle is being used.`);
  }

  const saysSmall = /\b(?:small|tiny|compact|courtyard|limited) (?:space|area|yard|park)?\b|\bindoors?\b/.test(text);
  const saysLarge = /\b(?:large|big|wide|open) (?:space|area|field|park)\b|\b(?:big|open) field\b/.test(text);
  if ((saysSmall && filters.space !== "small") || (saysLarge && filters.space === "small")) {
    conflicts.push(`Your description suggests a different space size; the space selector is being used.`);
  }

  const categoryMentions = [
    ["nature", /\b(?:nature|wildlife|birdwatching|scavenger hunt)\b/],
    ["tag", /\b(?:tag|chasing|chase)\b/],
    ["team", /\b(?:teamwork|team game|cooperative|cooperation)\b/],
    ["traditional", /\btraditional\b/],
    ["movement", /\b(?:movement|active|exercise)\b/],
    ["creative", /\b(?:creative|story|imagination)\b/],
  ].filter(([, pattern]) => pattern.test(text)).map(([category]) => category);
  if (filters.category !== "any" && categoryMentions.some((category) => category !== filters.category)) {
    conflicts.push(`Your description mentions a different game mood; the mood selector is being used.`);
  }

  return conflicts;
}

export function validateSearchFilters(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Search filters must be an object.");
  }

  const { players, minutes, space, equipmentAvailable, ageGroup, category } = input;
  if (!Number.isInteger(players) || players < 1 || players > 100) {
    throw new TypeError("players must be an integer between 1 and 100.");
  }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
    throw new TypeError("minutes must be an integer between 1 and 240.");
  }
  if (!SPACES.includes(space)) {
    throw new TypeError("space must be small, medium, or large.");
  }
  if (typeof equipmentAvailable !== "boolean") {
    throw new TypeError("equipmentAvailable must be a boolean.");
  }
  if (!AGE_GROUPS.includes(ageGroup)) {
    throw new TypeError(`ageGroup must be one of: ${AGE_GROUPS.join(", ")}.`);
  }
  if (category !== "any" && !CATEGORIES.includes(category)) {
    throw new TypeError(`category must be any or one of: ${CATEGORIES.join(", ")}.`);
  }

  return { players, minutes, space, equipmentAvailable, ageGroup, category };
}

export function validateExcludedIds(excludeIds = []) {
  if (!Array.isArray(excludeIds) || excludeIds.length > games.length) {
    throw new TypeError("excludeIds must be a list of known game IDs.");
  }
  if (excludeIds.some((id) => typeof id !== "string" || !games.some((game) => game.id === id))) {
    throw new TypeError("excludeIds must contain only known game IDs.");
  }
  return [...new Set(excludeIds)];
}

function meetsCoreNeeds(game, filters) {
  const [minAge, maxAge] = ageBounds[filters.ageGroup];
  return (
    filters.players >= game.minPlayers &&
    filters.players <= game.maxPlayers &&
    minAge >= game.minAge &&
    maxAge <= game.maxAge &&
    (filters.equipmentAvailable || game.equipment.length === 0)
  );
}

function fits(game, filters) {
  return (
    meetsCoreNeeds(game, filters) &&
    game.durationMinutes <= filters.minutes &&
    spaceRank[game.spaceRequirement] <= spaceRank[filters.space] &&
    (filters.category === "any" || game.categories.includes(filters.category))
  );
}

export function explainGameFit(game, filters) {
  const ageLabel = {
    "under-6": "ages 4–5",
    "6-8": "ages 6–8",
    "9-12": "ages 9–12",
    "13-plus": "ages 13+",
    mixed: "mixed ages 6+",
  }[filters.ageGroup];
  const spaceLabel = {
    small: "small",
    medium: "medium",
    large: "large",
  }[game.spaceRequirement];
  const mood = filters.category === "any" ? "your open game mood" : `the ${filters.category} mood`;
  const equipment = game.equipment.length
    ? "uses equipment you said is available"
    : "needs no equipment";
  return `Fits ${filters.players} players, takes about ${game.durationMinutes} of your ${filters.minutes} available minutes, works in a ${spaceLabel} space, suits ${ageLabel}, ${equipment}, and matches ${mood}.`;
}

export function searchGames(input, excludeIds = []) {
  const filters = validateSearchFilters(input);
  const excluded = new Set(validateExcludedIds(excludeIds));
  const availableGames = games.filter((game) => !excluded.has(game.id));
  const matches = availableGames
    .filter((game) => fits(game, filters))
    .sort((a, b) =>
      (filters.minutes - a.durationMinutes) - (filters.minutes - b.durationMinutes) ||
      a.id.localeCompare(b.id),
    );

  if (matches.length) {
    return {
      matches,
      count: matches.length,
      message: `${matches.length} game${matches.length === 1 ? "" : "s"} fit your group.`,
      suggestions: [],
    };
  }

  const suggestions = availableGames
    .filter((game) => meetsCoreNeeds(game, filters))
    .map((game) => ({
      game,
      score:
        Math.max(0, game.durationMinutes - filters.minutes) +
        Math.max(0, spaceRank[game.spaceRequirement] - spaceRank[filters.space]) * 20 +
        (filters.category !== "any" && !game.categories.includes(filters.category) ? 10 : 0),
    }))
    .sort((a, b) => a.score - b.score || a.game.id.localeCompare(b.game.id))
    .slice(0, 3)
    .map(({ game }) => game);

  return {
    matches: [],
    count: 0,
    message: suggestions.length
      ? "No games match every filter. These real library games may work if you can adjust the time, space, or category."
      : "No games in the library fit the player count, age group, and equipment constraints. Try changing one of those filters.",
    suggestions,
  };
}
