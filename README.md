# GullyGames AI

**Less scrolling. More playing.**

GullyGames AI is a small, open-source outdoor game finder for friends, families, and community groups. Choose your group size, ages, time, space, and equipment; the app searches a curated library of safe, easy-to-follow games and asks a local open-weight model to help explain the best fit.

## The problem

It can be hard to think of a game everyone can play with the time and space available. GullyGames makes it easier to choose an activity, get the rules, and put the phone away.

## Features

- 16 practical outdoor and all-ages game cards, including Kho-Kho Lite, Seven Stones, Nature Scavenger Hunt, and Birdwatching Challenge.
- Deterministic filters for player count, time, space, equipment, age group, and category.
- A bounded Ollama tool loop with `qwen3.5:2b`; clear deterministic recommendations when the local model is unavailable or times out.
- Responsive, mobile-first interface with game rules, equipment, and safety guidance.
- “Find Another Game” to explore more results.
- “Revive a Forgotten Game” to keep a family or childhood memory separate from AI-suggested adaptations.
- No paid inference API, account, browser image dependency, or external font request.

## Architecture

```text
Browser (plain HTML/CSS/JS)
        │ same-origin JSON requests
        ▼
Node.js HTTP server ── /api/games, /api/health, /api/recommend, /api/revive
        │
        ├── Deterministic search_games tool ── curated game library
        │
        └── Ollama JavaScript client ── qwen3.5:2b in the Codespace
                model request → tool call → app executes search → tool result → model answer
```

## Technology

- Node.js 24 and JavaScript ES modules
- Ollama's JavaScript package (`ollama`)
- Node's built-in HTTP server and test runner
- Plain HTML, CSS, and JavaScript

The project retains the repository's existing MIT license. The Ollama JavaScript package is distributed under MIT; its license is included in the installed package. The app itself has no other runtime dependencies.

## How recommendations work

1. The browser sends the user's selected constraints to `POST /api/recommend`.
2. The app validates each value, then offers the model one allowed tool: `search_games`.
3. The app validates the tool arguments and runs deterministic filters against `src/data/games.js`. The model never runs arbitrary code and cannot expand the user's selected constraints.
4. The matching library data is returned to the model to write a short recommendation. Cards and rules displayed by the app come from the library, not invented model content.
5. If the model does not call the tool, produces invalid tool arguments, reaches the iteration cap, times out, or cannot be reached, the app returns a visibly labeled deterministic result instead. The browser gives the specific fallback reason rather than implying every fallback means Ollama was offline.

The “Revive a Forgotten Game” form preserves the exact memory the user entered and labels generated rules as suggestions. It asks for more details before creating a play card and never claims that an AI adaptation is historically authentic.

## Why open-weight AI

An open-weight model can be run with tools people can inspect and operate themselves. In this project, the model is only one optional part of a deterministic application; the library search and core demo still work when inference is unavailable.

## Local model and privacy

In this setup, **Ollama runs the model locally within the GitHub Codespace**. The browser talks to the app server in the same Codespace, and that server talks to Ollama at `http://127.0.0.1:11434` by default. This does not mean the model is running on a visitor's laptop, and local inference in the Codespace is not an offline-laptop feature.

There are no API keys or paid inference services. User preferences and memories are handled by this app and the configured Ollama runtime; they are not sent to a third-party inference API. Hosting or configuring Ollama elsewhere changes that privacy boundary. The app does not persist submissions.

## Run it in a Codespace

Requirements: Node.js 24, npm, and Ollama available in the Codespace.

```sh
npm install
ollama pull qwen3.5:2b
npm run dev
```

When `OLLAMA_HOST` is not set (or points to local port 11434), starting the app checks for Ollama and attempts to run `ollama serve` if the local service is stopped. Ollama must be installed; the model must be pulled once. For a remote Ollama server, set `OLLAMA_HOST` and ensure that server is running.

Open forwarded port **3000** in the Codespaces Ports panel. The server binds to `0.0.0.0` for port forwarding. `npm start` runs the same server without file watching.

To use another Ollama host, export `OLLAMA_HOST` in your shell before starting the app; the app does not automatically load `.env` files. Set `PORT` to choose a different app port. `.env` is ignored by Git, and `.env.example` documents the optional settings.

## Demo

1. Open the forwarded app page.
2. Leave the defaults (6 players, mixed ages, 30 minutes, medium space, no equipment) and choose **Find My Game**.
3. Expand **Rules & safety** on a card.
4. Try **Find Another** to see another library result.
5. Enter a game memory under **Revive a Forgotten Game**. The memory must include enough detail to make a useful card; the app will ask questions if it does not.
6. Turn Ollama off or leave it unavailable to see the explicitly labeled deterministic fallback.

## Health and troubleshooting

- `GET /api/health` reports whether the app is running, whether Ollama can be reached, and whether `qwen3.5:2b` is installed.
- The app automatically tries to start local Ollama at startup when needed. If that does not work, run `ollama serve` in a second terminal and check `GET /api/health`.
- Results say **Ollama selected** only when the model called the search tool and selected a real matching game. A **Library fallback** badge explains whether Ollama timed out, could not be reached, skipped the tool, or returned unusable arguments.
- Check `GET /api/health` to distinguish a reachable Ollama server from an installed model.
- If recommendations show an Ollama timeout, ensure the model is warmed and allow up to 180 seconds for a slow Codespace. The agent makes bounded, non-thinking model calls and falls back to deterministic search after the timeout.
- If Ollama listens somewhere else, set `OLLAMA_HOST` to its reachable base URL before starting the app.
- If the model is slow, allow the request up to 180 seconds. A timed-out inference uses the deterministic game library instead.
- If a port is already in use, set `PORT=3001 npm run dev` and forward port 3001.
- Run the test suite with `npm test`; tests use mocked model responses and do not download a model.

## Screenshots

Screenshots can be added here after the Codespace demo is running:

- `docs/screenshots/home.png` — preference form and empty state
- `docs/screenshots/recommendation.png` — recommendation cards and safety details
- `docs/screenshots/revive-game.png` — a memory play card with suggested adaptations

## Safety and limitations

- Game cards are practical suggestions, not a substitute for adult supervision, local rules, or a group's judgment. Adapt play to weather, accessibility needs, and the actual space.
- The youngest age selector is ages 4–5; this library does not recommend games for children under four.
- The library avoids roads, unsafe water, heights, aggressive contact, and throwing objects at people. Check the rules and safety advice before playing.
- The library is curated and finite; strict filters may return no matches. The app will say so and only offer alternatives that actually exist in the library.
- Model responses can be unavailable or imperfect. The model does not determine whether an activity is safe; the curated game card and the people supervising play remain authoritative.
- The memory feature cannot verify what the original game was or where it came from. AI-generated details are adaptations, not historical facts.
- Ollama and the model must be installed and reachable for AI-generated recommendations. The deterministic search remains available without them.
- The model is hosted by the Codespace in this setup; this project has not been tested as an offline app on a personal laptop.

## Contributing

Add or refine a game in `src/data/games.js`, keep the safety notes clear, and add tests for new search behavior. Run `npm test` before opening a pull request.
