# Fairway Ledger — Golf Bet Tracker

A single-file web app for tracking a golf group's per-round bets. Built as a
Claude Artifact (published at https://claude.ai/artifact/4KEgXTtfqqLBPG1ZeodusC)
and iterated on in a chat conversation — this brief plus `golf-bet-tracker.html`
is everything from that conversation, so you don't need the chat history.

## Important: how storage currently works

The app currently persists data (players, rounds) through Claude's `db`
capability — a `window.storage`-like API (`claude.use('db')`, then
`db.collection(...).doc(...).set/get/onSnapshot/delete`) that **only works
when this exact file is published/hosted as a Claude Artifact on claude.ai.**

If you deploy this file anywhere else (GitHub Pages, your own server, etc.)
as-is, `claude.use('db')` will fail and there will be no persistence. Two
options going forward:
1. Keep it hosted as a Claude Artifact (this repo is then just source control
   / backup — you'd still copy updated files back to claude.ai to publish).
2. Replace the storage layer with a real backend (e.g. Firebase, Supabase, a
   small self-hosted API) if you want this to run independently of Claude's
   artifact hosting. This would mean rewriting `subscribe()`, `savePlayer`,
   `deletePlayerDoc`, `saveRound`, `deleteRoundDoc` in the `<script>` block.

## Feature summary (what's built)

- **Roster** — persistent player list, add/remove anytime. Removing a player
  keeps their name in past round history (rounds snapshot player names).
- **New Round** — pick a date and course name, check in who played, and enter
  each player's final 18-hole gross score and total dot count (no hole-by-hole
  entry — that was tried and explicitly simplified away).
- **Teams tab** — pick players for an upcoming round, choose 2 or 3 teams, hit
  "Suggest teams" to auto-balance by average gross score, and manually
  re-assign any player to a different team via a dropdown. Team averages are
  shown live.
  - Balancing algorithm: seeds teams with equal (or as-equal-as-possible)
    sizes via a snake/boustrophedon fill of players sorted by average, then
    runs a swap-based local search (try swapping one player between every
    pair of teams; keep the swap if it shrinks the gap between the highest
    and lowest team average) until no swap helps. This replaced a pure greedy
    approach that could get stuck in a suboptimal split for small groups.
  - Player "average" is **recency-weighted**: most recent round = full
    weight, each round back multiplies weight by 0.6 (exponential decay), so
    a hot/cold streak shows up faster than a flat career average.
- **History tab** — "Round History": list of past rounds, collapsed to
  `date — course name`; tap to expand inline and see each player's gross +
  dots (no payout info shown here on purpose). Expanded rows have links to
  edit the round, view the full payout/teams summary, or delete (two-step
  inline confirm — see note below).
- **Player History tab** — matrix table: one row per player, one column per
  round (headed by course name, falling back to date), gross score per cell.
  Trailing **Total** and **Average** columns (plain/unweighted, unlike the
  Teams-tab average). Sorted by Total ascending.
- **Round summary page** (reached after saving a round, or via "View payouts
  & teams" from History) — score table, **dot payouts**: pairwise $0.25 per
  dot of difference between every pair of players, fully settled (not
  netted), grouped by player from most dots to fewest, and within each
  player's group sorted by the other player's dot count descending. Also has
  its own "Next round teams" balance suggester scoped to that round's
  players.
- Money/skins (team best-ball, $5/player pot) was in an early version and was
  **explicitly removed** at the user's request in favor of the simpler
  final-score-only entry — don't reintroduce it unless asked.

## Known quirk / design note

Native `confirm()`/`alert()` dialogs don't reliably fire inside a published
Artifact's sandboxed frame — a real bug we hit where "Delete" silently did
nothing. All destructive actions now use an in-app two-step inline confirm
(`confirmAction()` helper) instead of `window.confirm`. Keep using that
pattern for any new destructive action; don't reach for `confirm()`/`alert()`.

## Visual design

Golf/fairway theme: CSS custom properties for a sand/fairway-green palette,
Fraunces (serif, headings) + Inter (body) from Google Fonts, light/dark mode
via `prefers-color-scheme` and `data-theme`. See the `<style>` block in the
HTML file for the full token set.

## Suggested first steps in Claude Code

1. `git init`, add `golf-bet-tracker.html` and this brief, initial commit.
2. Decide on the storage question above (stay on Claude Artifact hosting vs.
   migrate to a real backend) before making further changes — it affects how
   much of the `<script>` block is safe to touch.
3. If staying on Artifact hosting: after each change, the file still needs to
   be re-published as a Claude Artifact (via claude.ai) to actually go live;
   Claude Code editing the local file alone won't update the hosted version.
