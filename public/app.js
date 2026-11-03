const recommendationForm = document.querySelector("#recommend-form");
const reviveForm = document.querySelector("#revive-form");
const resultsSection = document.querySelector("#results-section");
const emptyState = document.querySelector("#empty-state");
const loadingState = document.querySelector("#loading-state");
const results = document.querySelector("#results");
const findButton = document.querySelector("#find-button");
const reviveButton = document.querySelector("#revive-button");
const reviveResult = document.querySelector("#revive-result");
let excludedIds = [];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function readResponse(response) {
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an unreadable response. Please retry.");
  }
  if (!response.ok) throw new Error(data.error || `The request failed (${response.status}).`);
  return data;
}

function list(title, items) {
  const section = document.createElement("section");
  section.append(element("h4", "", title));
  const ul = document.createElement("ul");
  for (const item of items) ul.append(element("li", "", item));
  section.append(ul);
  return section;
}

function renderGame(game) {
  const card = element("article", "game-card panel");
  const top = element("div", "game-card-top");
  const heading = document.createElement("h3");
  heading.textContent = game.name;
  const category = element("span", "game-category", game.categories[0]);
  top.append(heading, category);
  card.append(top, element("p", "", game.description));

  const facts = element("div", "game-facts");
  facts.append(
    element("span", "", `${game.minPlayers}–${game.maxPlayers} players`),
    element("span", "", `${game.durationMinutes} min`),
    element("span", "", `${game.spaceRequirement} space`),
    element("span", "", game.equipment.length ? game.equipment.join(", ") : "No equipment"),
  );
  card.append(facts);
  if (game.whyItFits) card.append(element("p", "why-it-fits", game.whyItFits));

  const details = document.createElement("details");
  details.append(element("summary", "", "Rules & safety"));
  details.append(list("How to play", game.rules));
  details.append(list("Play safely", game.safety));
  card.append(details);
  return card;
}

function renderRecommendations(data) {
  results.replaceChildren();
  const heading = element("div", "results-header");
  const titleBlock = document.createElement("div");
  titleBlock.append(element("h2", "", data.games.length ? "Your game shortlist" : "Let's adjust the plan"));
  const fallback = data.mode === "deterministic-fallback";
  const fallbackLabels = {
    "ollama-timeout": "Library fallback · Ollama timed out",
    "ollama-unavailable": "Library fallback · Ollama could not be reached",
    "ollama-model-missing": "Library fallback · configured model is not installed",
    "model-did-not-call-search-games": "Library fallback · model skipped game search",
    "invalid-tool-arguments": "Library fallback · model returned invalid search filters",
    "tool-arguments-did-not-match-request": "Library fallback · selected filters kept",
    "model-did-not-select-library-game": "Library fallback · model did not select a library game",
    "unsupported-tool": "Library fallback · unsupported model tool request",
    "tool-call-limit": "Library fallback · model reached the tool-call limit",
    "iteration-limit": "Library fallback · model reached the step limit",
    "invalid-model-response": "Library fallback · model returned an invalid response",
  };
  titleBlock.append(element("span", `source-badge${fallback ? " fallback" : ""}`,
    fallback
      ? fallbackLabels[data.fallbackReason] || "Library fallback · deterministic search"
      : data.games.length
        ? "Ollama selected · game-library facts"
        : "Ollama searched · no matching games"));
  if (data.answer && data.games.length) {
    titleBlock.append(element("p", "recommendation-answer", data.answer));
  }
  const another = element("button", "another-button", "Find another ↗");
  another.type = "button";
  another.hidden = data.games.length === 0;
  another.addEventListener("click", async () => {
    excludedIds = [...new Set([...excludedIds, ...data.games.map((game) => game.id)])];
    if (excludedIds.length >= 15) excludedIds = [];
    await getRecommendations();
  });
  heading.append(titleBlock, another);
  results.append(heading);

  for (const conflict of data.conflicts ?? []) {
    results.append(element("p", "preference-warning", `${conflict} Selected filters take priority.`));
  }
  for (const game of data.games) results.append(renderGame(game));
  if (!data.games.length) {
    const empty = element("div", "empty-results panel");
    empty.append(element("h3", "", "No exact matches this time."));
    empty.append(element("p", "", data.message || "Try changing a filter and searching again."));
    if (data.suggestions?.length) {
      empty.append(element("p", "", "Real library games to consider if you can adjust your plan:"));
      const ul = document.createElement("ul");
      for (const game of data.suggestions) ul.append(element("li", "", `${game.name} — ${game.description}`));
      empty.append(ul);
    }
    results.append(empty);
  }
  results.hidden = false;
  emptyState.hidden = true;
}

async function getRecommendations() {
  const formData = new FormData(recommendationForm);
  const filters = {
    players: Number(formData.get("players")),
    minutes: Number(formData.get("minutes")),
    space: formData.get("space"),
    equipmentAvailable: formData.get("equipmentAvailable") === "on",
    ageGroup: formData.get("ageGroup"),
    category: formData.get("category"),
    request: formData.get("request").trim(),
    excludeIds: excludedIds,
  };
  findButton.disabled = true;
  resultsSection.setAttribute("aria-busy", "true");
  loadingState.hidden = false;
  emptyState.hidden = true;
  results.hidden = true;
  try {
    const response = await fetch("/api/recommend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(filters),
    });
    const data = await readResponse(response);
    if (!response.ok) throw new Error(data.error || "Could not find a game.");
    renderRecommendations(data);
  } catch (error) {
    results.replaceChildren(element("p", "error-message", error.message));
    results.hidden = false;
    emptyState.hidden = true;
  } finally {
    loadingState.hidden = true;
    findButton.disabled = false;
    resultsSection.setAttribute("aria-busy", "false");
  }
}

recommendationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  excludedIds = [];
  void getRecommendations();
});

function renderReviveCard(data) {
  reviveResult.replaceChildren();
  if (data.needsClarification) {
    reviveResult.append(element("h3", "", "Tell us a little more"));
    reviveResult.append(element("p", "", "We need a few details before turning this memory into a useful play card."));
    reviveResult.append(list("A couple of helpful questions", data.questions));
    return;
  }

  const { card } = data;
  reviveResult.append(element("h3", "", card.name));
  reviveResult.append(element("p", "", "Your memory — exactly as shared"));
  reviveResult.append(element("p", "", card.userProvidedDetails));
  if (card.rememberedPlayDetails?.length) {
    reviveResult.append(list("Remembered play details · user-provided", card.rememberedPlayDetails));
  }
  reviveResult.append(list("Suggested playable draft · not verified original rules", card.suggestedRules));
  if (card.suggestedEquipment.length) reviveResult.append(list("Suggested equipment", card.suggestedEquipment));
  reviveResult.append(list("Adaptations & safety", card.adaptations));
  reviveResult.append(element("p", "revive-mode", data.mode === "ollama"
    ? "Structured with local Ollama; suggestions are not verified original rules."
    : data.fallbackReason === "ollama-timeout"
      ? "Basic play card; local Ollama timed out, so no AI suggestions were used."
      : data.fallbackReason === "ollama-model-missing"
        ? "Basic play card; the configured model is not installed, so no AI suggestions were used."
        : "Basic play card; Ollama was unavailable, so no AI suggestions were used."));
  const copy = element("button", "button button-secondary", "Copy this game card");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    const text = [
      card.name,
      `Your memory: ${card.userProvidedDetails}`,
      `Remembered play details: ${card.rememberedPlayDetails.join("; ")}`,
      `Suggested playable draft: ${card.suggestedRules.join("; ")}`,
      `Suggested equipment: ${card.suggestedEquipment.join(", ") || "None suggested"}`,
      `Adaptations and safety: ${card.adaptations.join("; ")}`,
    ].join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = "Copied!";
    } catch {
      copy.textContent = "Copy unavailable on this connection";
    }
  });
  reviveResult.append(copy);
}

reviveForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(reviveForm);
  reviveButton.disabled = true;
  reviveResult.setAttribute("aria-busy", "true");
  reviveResult.replaceChildren(element("p", "", "Making your play card…"));
  try {
    const response = await fetch("/api/revive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name").trim(),
        details: formData.get("details").trim(),
      }),
    });
    const data = await readResponse(response);
    renderReviveCard(data);
  } catch (error) {
    reviveResult.replaceChildren(element("p", "error-message", error.message));
  } finally {
    reviveButton.disabled = false;
    reviveResult.setAttribute("aria-busy", "false");
  }
});
