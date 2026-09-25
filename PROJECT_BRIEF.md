# The 2026 Lake Open — golf group tracker ("powered by Settle up Golf")

A single-file web app (`index.html`, no build step) for a golf group's rounds: live scoring from scorecard photos, teams, skins and betting payouts. It started as a Claude Artifact ("Fairway Ledger") and now has its own hosting. This brief plus the repo is everything needed to continue; the original chat history is not required.

- **Current version:** v1.0 (git tag `v1.0`, released 2026-09-24). Older tag: `v0.1`.
- **Live site:** https://dstocksick.github.io/Golf-Tracker/ (GitHub Pages, served from `master`)
- **Repo:** https://github.com/dstocksick/Golf-Tracker (public; free-plan Pages needs a public repo)
- **Branches:** work on `experiment`; merge to `master` (fast-forward) only when the user says so, because `master` deploys to the live site friends use.

## Architecture

| Piece | What | Notes |
|---|---|---|
| Frontend | `index.html` (vanilla JS, inline CSS) | Fonts from Google Fonts. Theme pinned to light (`data-theme="light"` on `<html>`). |
| Data | Firebase Firestore, project `golf-bet-tracker-cba58` | Collections `players` and `rounds`, compat SDK from Google's CDN. Rules are open (`allow read, write: if true`) so friends need no login. Nothing sensitive belongs in it. |
| Scorecard reading | Firebase Cloud Function `parseScorecard` (`functions/index.js`) | Calls the Google Gemini API. Node.js 22, 2nd gen, `us-central1`, `firebase-functions` 7. |
| Hosting | GitHub Pages | Merge to `master` and push; Pages rebuilds in about a minute. |

Firebase is on the **Blaze** plan (required for Cloud Functions; cost stays near $0). The Gemini API is **not free** (prepaid credits, see below).

## How a round works (v1.0)

1. **Start Round** tab — only course and date. Creates a shared round in Firestore with `complete: false` and jumps to Live Leaderboard. If a round is already in progress the tab shows "Round in progress" with a link instead (only one live round at a time).
2. **Live Leaderboard** tab (gold dot on the tab while a round is live) — anyone with the link can view it on their own phone, and anyone can add photos:
   - "This photo shows" selector: Front 9 / Back 9 / Full 18 (physical cards fold, so one card is usually two photos). Smart default: Front 9 when nothing is in, Back 9 when a player has front 9 but not back 9.
   - Take photo / Choose photo → Cloud Function reads gross scores → editable review grid (player match dropdown, 18 hole inputs, live Front 9 / Back 9 / Total) → "Add live".
   - Each review row has a **Team** picker. Default: the player's existing team, else the team of another already-teamed player on the same photo, else a new team. Pick a different team to override (e.g. a mixed card).
   - The **Team** column in the individual list is a dropdown too, so a player's team can be fixed mid-round (writes only `scores.<pid>.team`; "–" takes them off a team).
   - Shows live **team best-ball score and skins through the holes known so far** (a hole counts once every team has at least one score for it) and an individual list (holes played, running gross; not directly comparable until everyone has played the same holes).
   - **Tap a player's name** in the individual list to edit their 18 holes and team mid-round (`renderLivePlayerEditor`). Save writes only `scores.<pid>.holes/gross/team` in a transaction, so dots/greenies and other players are untouched; "No team" deletes the team field.
   - "Add live" runs in a Firestore **transaction** (`addLiveRows`): the default team and any holes not in this photo come from the server's latest copy of the round, not the phone's (which can be stale after the camera app or when two cards go in at once). Before this, separate one-person cards all landed on Team 1.
   - Writes go straight to Firestore with field-level `update()` (`scores.<pid>`, `arrayUnion` on `playerIds`/`roundPlayers`), so two teams photographing at once cannot overwrite each other (verified against real Firestore).
3. **Review & complete round** button → the New Round screen in edit mode, relabeled "Complete round": final review of players/teams/holes, manual **Dots** and **Greenies** entry, then a two-step confirm ("This will end the round for all players and teams. Are you sure?") that saves with `complete: true`.

The same edit screen is used by History → Edit for finished rounds (button says "Save changes", no confirm). Manual gross-only entry still works there (rounds without hole scores just have no team result).

## Tabs

Roster · Start Round · Live Leaderboard · Team Creation · Team Results · History · Player History

- **Roster** — persistent player list. Removing a player keeps their name in past rounds.
- **Team Creation** — pick players, 2 or 3 teams, "Suggest teams" balances by recency-weighted average gross (snake seed + swap local search; weight 0.6 per round back). The only place team suggestion lives.
- **Team Results** (finished rounds only) — round picker; team score and skins card (small "Winner"/"Tie" tag, no banner); collapsible **Betting payouts** (starts open) and **Hole by hole** (starts closed).
- **History** (finished rounds only) — collapsed to `date — course · N players · Team X won`; expanded shows Team column with a "Winner" badge and the result line; links to Edit, Round Summary and Delete.
- **Player History** — gross matrix per player per finished round with Total and Average.
- **Round Summary** page (from History) — score table and the dot payouts. It does not show teams or team betting.

Finished round = `complete !== false` (old rounds have `complete: true`). `currentLiveRound()` and `finishedRounds()` are the helpers.

## Game rules implemented

**Team score (best ball).** Per hole take the lowest gross on the team; sum the holes. Lower wins. All players on one scorecard are one team. `computeTeamResults` works per hole and only counts holes where every team has a score, so it gives a partial result live and the identical final result once all 18 are in.

**Skin.** A team wins a hole outright when its best score is strictly lower than every other team's. Ties count for nothing; nothing carries over.

**Team betting** (`computeBets`; dots are not involved):
1. Every player pays **$5** into the pot.
2. Each member of the winning team gets **$2** back. Tied team score: nobody gets it.
3. Each greenie pays **$0.25 × number of players** to the player who earned it (individual, not team).
4. What's left is divided by total skins (both teams) to get the value of one skin.
5. Each team's skin money is split **evenly among all its members**, regardless of who made the low score or team size.
6. No skins at all: the remainder is split evenly among all players.
7. **Payouts are rounded to the nearest quarter and always sum exactly to the pot.** Refunds and greenies are already quarter multiples; only the skin split is rounded, using the largest-remainder method (extra or missing quarters go to whoever rounded furthest from their exact share).
8. A player with no team still pays in and can collect greenies but gets no refund or skins.

**Dot payouts** (Round Summary, separate): pairwise $0.25 per dot of difference between every pair of players, fully settled, grouped by player from most dots to fewest.

## Data model (Firestore `rounds` documents)

```
{ date, course, playerIds: [pid], roundPlayers: [{id, name}], complete: bool,
  scores: { [pid]: { gross, dots, greenies, holes?: [18 numbers], team?: 1-4 } } }
```

A live round starts as `{date, course, playerIds: [], roundPlayers: [], scores: {}, complete: false}`. `holes` exists only when scores came from a photo import; a hole of 0 means missing/unreadable. `team`, `greenies`, `holes` may be absent on older rounds and are handled. Players are `{name}` documents.

## Scorecard photo import

**Function** (`functions/index.js`): model `gemini-3.6-flash`, `temperature: 0`, JSON-schema response `players: [{writtenName, matchedRosterName, holes[]}]` plus `notes`. The request sends `holeRange` (`front`|`back`|`full`), and the prompt tells the model to expect exactly 9 or 18 columns and to ignore the OUT/IN subtotal column. `model` and `temperature` overrides exist only for experiments. The API key is the Firebase Functions secret `GEMINI_API_KEY` (never in the browser). URL: `https://us-central1-golf-bet-tracker-cba58.cloudfunctions.net/parseScorecard`.

**Client** (`importScorecardPhoto` for the edit screen, `importScorecardPhotoLive` for Live Leaderboard):
- Matches rows to the roster by name. If a whole photo has **no names** (typical for the back half of a folded card), `guessRowsByRowOrder` matches by row order, but only when exactly one team is still missing that half with a matching row count. Guessed rows are flagged "matched by row order — please confirm". If two teams are equally incomplete it refuses to guess and the user picks manually.
- The review grid always shows the merged 18 holes: this photo's holes plus the player's existing ones (`mergeRowHoles` / `mergeRowHolesLive`), re-merged live when the player dropdown changes so existing data is never overwritten with zeros.

**Card layout the prompt assumes:** players as rows, hole columns, small handwritten dots above scores (ignored).

**What we learned (don't repeat):**
- **Dots:** counting the dot marks was unreliable through every experiment (per-hole tallies, resolution, temperature, Pro model). Dots are entered by hand.
- **Photo quality:** Gemini downsamples internally, so file size doesn't help; a straight-on, well-framed, close photo does.
- **Model:** the Pro model dropped a hole and shifted a row. Stay on flash.
- **Variance:** even at temperature 0 the same photo can read slightly differently between runs, so always check the review grid.
- Holes 9/10 (near the OUT subtotal) are the most error-prone.

**Cost:** Gemini bills prepaid credits, roughly $0.02–0.03 per photo. If credits run out the import fails with "prepayment credits are depleted"; top up at https://ai.studio/projects. A comparison found Claude's API would be about $0.005–0.01 per call, but the user chose to stay on Gemini.

## Development workflow

- **Local test server:** `.claude/launch.json` defines `static-site` (`npx serve`, port 5510); start it with `preview_start`. From a phone on the same WiFi use `http://<computer LAN IP>:5510` (was `192.168.1.228`; check with `Get-NetIPAddress`). It talks to the **real Firestore**.
- **Testing without polluting real data:** test UI logic in memory (set `rounds = [...]`, `window.__newRoundState`, call `go('team-results')`, mock `window.fetch` for the Cloud Function). If a test truly needs Firestore (like the live-round flow), use an obvious throwaway round (course `ZZ_TEST_DELETE_ME`) and delete it with `deleteRoundDoc` afterward.
- **Local-only fixtures** (gitignored): `scorecard.jpeg` (real photo), `scorecard-test-data.json` and `scorecard-test-data-2.json` (verified hole scores for two teams). Use them instead of calling Gemini repeatedly.
- **Deploying the function:** from the repo root, `.\node_modules\.bin\firebase.cmd deploy --only functions`. The Firebase CLI is a local devDependency, not global. Secret: `firebase functions:secrets:set GEMINI_API_KEY --data-file <file>` with a file **without a trailing newline** (piping through PowerShell adds one and Gemini then rejects the key).
- **Deploying the site:** `git checkout master; git merge --ff-only experiment; git push origin master; git checkout experiment`, then confirm with `gh api repos/dstocksick/Golf-Tracker/pages/builds/latest`. Tag releases (`v1.0` style) on request.
- `git`, `gh` and `node` were installed with winget. The `gh` and Firebase logins were done once by the user in their own terminal (interactive browser sign-in).

## Quirks and gotchas

- **No `confirm()`/`alert()`.** Use `confirmAction(key, label, onConfirm, confirmText)` or the two-step big-button pattern (`window.__pendingConfirm`) for consequential actions.
- **`el()` boolean props** are assigned as properties; `setAttribute('disabled', false)` would still disable the element.
- **Hidden file inputs** use a visually-hidden style, not `display:none`, so mobile Safari lets buttons trigger them.
- **PowerShell commit messages:** double quotes inside a `git commit -m @'...'@` message get split into extra arguments. Avoid double quotes in commit text.
- **Environment split:** the agent's PowerShell and the user's own terminal don't share per-user `%APPDATA%`, but do share `C:\Program Files`, the project folder and credential stores. Install CLIs as local devDependencies.
- The Gemini key must never be in the repo. The Firebase web config in `index.html` is public by design.

## Maintenance notes

- Cloud Function runtime is Node 22 (Node 20 support ends 2026-10-30). Watch for the next runtime deprecation notice on deploy.
- Firestore rules are open; if abuse ever matters, add anonymous auth plus rules.
- Keep this brief updated when features change.

## Ideas not built

- Carryover for tied skin holes (explicitly not wanted so far); a tiebreaker for tied team scores (currently "Tie", no refund).
- Team betting on the Round Summary page (it only has dot payouts).
- Live hole-by-hole table and live betting preview on Live Leaderboard (only team score/skins and the individual list are shown).
- Editing/undoing a single live import after "Add live" (fix it from Complete round or History → Edit).
- Auto-guessing unnamed back-9 rows when two equal-size teams are both incomplete (currently manual on purpose).
- Per-hole dot tracking (only totals are wanted).
