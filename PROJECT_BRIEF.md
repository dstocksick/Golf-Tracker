# The 2026 Lake Open — golf group tracker ("powered by Settle up Golf")

A single-file web app (`index.html`, no build step) for a golf group's rounds:
scores, teams, skins and betting payouts. It started as a Claude Artifact
("Fairway Ledger") and has since moved to its own hosting. This brief plus the
repo is everything you need; you don't need the original chat history.

- **Live site:** https://dstocksick.github.io/Golf-Tracker/ (GitHub Pages, served from `master`)
- **Repo:** https://github.com/dstocksick/Golf-Tracker (public; Pages on a free plan needs a public repo)
- **Branches:** work happens on `experiment`; merge to `master` only when a change is confirmed, because `master` deploys to the live site your friends use.

## Architecture

| Piece | What | Notes |
|---|---|---|
| Frontend | `index.html` (vanilla JS, inline CSS) | Fonts from Google Fonts. Theme is pinned to light (`data-theme="light"` on `<html>`). |
| Data | Firebase Firestore, project `golf-bet-tracker-cba58` | Collections `players` and `rounds`. Loaded with the compat SDK from Google's CDN. Rules are open (`allow read, write: if true`) so friends need no login. Don't store anything sensitive. |
| Scorecard reading | Firebase Cloud Function `parseScorecard` (`functions/index.js`) | Calls the Google Gemini API. Node.js 22 runtime, 2nd gen, `us-central1`. |
| Hosting | GitHub Pages | Commit and push `master`; Pages rebuilds in about a minute. |

Firebase is on the **Blaze** (pay-as-you-go) plan, which Cloud Functions requires. Usage stays near $0. The Gemini API is **not free**: it runs on prepaid credits (see "Scorecard photo import").

## Features

- **Roster** — persistent player list. Removing a player keeps their name in past rounds (rounds snapshot names).
- **New Round** (top to bottom):
  1. **Import from scorecard photo** — "Take photo" (opens the camera) or "Choose photo" (file picker). "Clear round" resets the whole form (two-step confirm).
  2. **Course and date.**
  3. **Import review card** (appears after a photo is read) — per player: roster match dropdown, all 18 hole scores (editable), live Front 9 / Back 9 / Total. "Add to round" merges into the form; "Discard" drops it.
  4. **Who played?** table — columns: **Team** (T1–T4 dropdown, left of the checkbox), player, **Gross**, **Dots**, **Greenies**. Dots and Greenies are entered by hand.
  - Importing several photos in one round is supported (one photo per scorecard). Each import becomes the next team automatically (first photo T1, second T2, ...); the Team dropdown lets you change anyone.
  - Entering only a gross score by hand (no photo) is still allowed; such rounds just have no hole-by-hole data.
- **Team Creation tab** (formerly "Teams") — pick players for an upcoming round, choose 2 or 3 teams, "Suggest teams" auto-balances by average gross score; reassign players via dropdown. This is now the only place team suggestion lives (it was removed from the Round Summary page).
  - Balancing: snake/boustrophedon seed, then a swap-based local search that shrinks the gap between the highest and lowest team average.
  - A player's average is recency-weighted (each round back multiplies weight by 0.6).
- **Team Results tab** — pick a round (defaults to the newest). Shows:
  - **Team score and skins**: each team's score, skins, a small "Winner" tag on the lower score ("Tie" if equal), the holes each team won, and the tied-hole count. No banner by design.
  - **Betting payouts** (collapsible, starts open): calculation steps plus a per-player table (Refund, Greenies, Skins, Payout, Net).
  - **Hole by hole** (collapsible, starts closed): lowest score per team per hole, who had it, OUT/IN/total. Skin holes are highlighted.
  - A round without hole-by-hole scores shows "Needs hole by hole scores"; a round with fewer than two teams says teams are needed. A hole score of 0 (unreadable) counts as missing.
- **History tab** — rounds collapse to `date — course · N players · Team X won`. Expanded rows show player, Team (with a "Winner" badge for the winning team), gross, dots, plus a "Winning team: Team 2 (69–71)" line. Links to Edit, the Round Summary, and Delete (two-step confirm).
- **Player History tab** — matrix of gross scores per player per round with Total and Average (plain, unweighted), sorted by Total.
- **Round Summary page** (after saving, or "View payouts & teams" from History) — score table and **dot payouts** (below). It does not show teams or team betting yet; that lives on Team Results.

## Game rules implemented

**Team score (best ball).** For each hole take the lowest gross score by anyone on the team; sum the 18 holes. Lower total wins. All players on one scorecard are one team.

**Skin.** A team wins a hole outright when its best score on that hole is strictly lower than every other team's. Ties count for nothing and nothing carries over.

**Team betting** (`computeBets` in `index.html`; dots are not involved at all):
1. Every player who played pays **$5** into the pot.
2. Each member of the winning team gets **$2** back. If the team scores tie, nobody gets it.
3. Each greenie is worth **$0.25 × number of players**, paid to the player who earned it (greenies are individual, not team).
4. The money left is divided by the **total skins** (both teams) to get the value of one skin.
5. Each team's skin money is split **evenly among all its members**, regardless of who made the low score or team size.
6. If no skins were earned, the remaining money is split evenly among all players.
7. Every amount is rounded to the cent; if that leaves the payouts a penny off the pot, the table says so.
8. A player with no team still pays in and can collect greenies, but gets no refund or skins.

Net = payout minus the $5 buy-in; nets sum to about $0.

**Dot payouts** (Round Summary, separate from the above): pairwise $0.25 per dot of difference between every pair of players, fully settled (not netted), grouped by player from most dots to fewest.

## Data model (Firestore `rounds` documents)

```
{ date, course, playerIds: [pid], roundPlayers: [{id, name}], complete: true,
  scores: { [pid]: { gross, dots, greenies, holes?: [18 numbers], team?: 1-4 } } }
```

`holes` is present only when the scores came from a photo import. `team` is optional. Old rounds may lack `greenies`, `holes` and `team` and are handled gracefully. Players are `{name}` documents.

## Scorecard photo import

**Flow:** photo → browser sends base64 to the Cloud Function → Gemini reads the card → editable review grid → nothing is saved until you press Add to round and then Save round.

**Function** (`functions/index.js`): model `gemini-3.6-flash`, `temperature: 0`, JSON-schema response (`players: [{writtenName, matchedRosterName, holes[18]}]`, `notes`). The request body may include `model` and `temperature` overrides, used only for experiments. The API key is a Firebase Functions secret named `GEMINI_API_KEY`; it never ships to the browser. Function URL: `https://us-central1-golf-bet-tracker-cba58.cloudfunctions.net/parseScorecard`.

**Card layout the prompt assumes:** players as rows, 18 hole columns, small handwritten dots above scores (which the prompt tells the model to ignore).

**What we learned (don't repeat these experiments):**
- **Dots:** counting the small dot marks above scores was tried with per-hole tallies, higher resolution, temperature 0, and the Pro model, and stayed unreliable (best about 10–12 of 18 holes right). Dots are entered manually; the prompt tells the model to ignore them.
- **Photo quality beats file size:** Gemini downsamples large images internally, so a bigger file doesn't help. A **straight-on, well-framed, close** photo did (a tilted whole-card shot had a wrong digit or two; a straight-on retake read perfectly).
- **Model choice:** the Pro model (`gemini-3.1-pro-preview`) was worse, dropping a whole hole and shifting the row. Stay on flash.
- **Variance:** even at temperature 0 the same photo can read slightly differently between runs (one run had two players with small misreads, an identical rerun was perfect). That is why the review grid exists; always check it before adding to the round.
- Hole 9/10 (the OUT-total row on the printed card) was the most error-prone spot.

**Cost:** the Gemini API bills prepaid credits, roughly $0.02–0.03 per scorecard photo. If credits run out the import fails with "prepayment credits are depleted"; top up at https://ai.studio/projects. A cost comparison found Claude's API would be roughly $0.005–0.01 per call, but the user chose to stay on Gemini (switching effort wasn't worth cents per month).

## Development workflow

- **Local test server:** `.claude/launch.json` defines `static-site` (`npx serve` on port 5510). From a phone on the same WiFi use `http://<computer LAN IP>:5510`. The app always talks to the real Firestore, so **don't save test rounds** to it; in-memory tests (set `rounds = [...]`, `window.__newRoundState`, then `go('team-results')`) avoid polluting real history.
- **Test fixtures** (gitignored, local only): `scorecard.jpeg` (a real card photo) and `scorecard-test-data.json` / `scorecard-test-data-2.json` (verified player hole scores for two teams). Use them instead of calling Gemini every time.
- **Deploying the function:** from the repo root, `.\node_modules\.bin\firebase.cmd deploy --only functions`. The Firebase CLI is a local devDependency, not a global install (see quirks). Secrets: `firebase functions:secrets:set GEMINI_API_KEY --data-file <file>` — pass a file **without a trailing newline**, because piping through PowerShell adds one and Gemini then rejects the key as invalid.
- **Deploying the site:** merge to `master` and push; check Pages with `gh api repos/dstocksick/Golf-Tracker/pages/builds/latest`.
- `git`, `gh`, and `node` were installed with winget. The `gh` login and Firebase login were done once by the user in their own terminal (interactive browser sign-in).

## Quirks and gotchas

- **No `confirm()`/`alert()`.** They don't work in a sandboxed frame. Use the two-step inline `confirmAction(key, label, onConfirm, confirmText)` helper for destructive actions.
- **`el()` boolean props.** The DOM helper assigns boolean values (e.g. `disabled: false`) as properties; `setAttribute('disabled', false)` would still disable the element (this bug once made the photo buttons dead).
- **Hidden file inputs** use a visually-hidden style, not `display:none`, so mobile Safari lets buttons trigger them.
- **PowerShell commit messages:** double quotes inside a `git commit -m @'...'@` message get split into extra arguments. Avoid double quotes in commit text.
- **Environment split:** the agent's PowerShell and the user's own terminal don't share per-user `%APPDATA%` (a global `npm install -g` in one was invisible to the other), but do share `C:\Program Files`, the project folder, and credential stores. Install CLIs as local devDependencies.
- Nothing in the repo should contain the Gemini key. The Firebase web config in `index.html` is public by design.

## Maintenance notes

- Cloud Function runtime was upgraded to **Node.js 22** and `firebase-functions` ^7 (Node 20 support ends 2026-10-30). Watch for the next runtime deprecation notice on deploy.
- Firestore rules are open; if abuse ever becomes a concern, add anonymous auth plus rules.
- `PROJECT_BRIEF.md` should be updated when features change.

## Ideas not built

- Carryover for tied skin holes (explicitly not wanted so far).
- A tiebreaker for tied team scores (currently "Tie", no refund).
- Team betting on the Round Summary page (it only has dot payouts).
- Per-hole dot tracking (only the total is wanted).
