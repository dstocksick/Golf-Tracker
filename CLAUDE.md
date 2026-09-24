# Working on The 2026 Lake Open (golf tracker)

Read `PROJECT_BRIEF.md` first — it has the architecture, features, game rules, data model, dev workflow and gotchas. Current release: v1.0 (tag `v1.0`).

## Rules for working here

- Work on the `experiment` branch. Merge to `master` (fast-forward) only when the user asks; `master` deploys to the live site their friends use. Tag releases only on request.
- For anything sizeable, discuss the approach and get agreement before coding; for small tweaks, just do them. Test in the browser before saying it works, at phone width (375px) for UI changes.
- Never save test data to the real Firestore and leave it there. Test in memory, or use a throwaway round named `ZZ_TEST_DELETE_ME` and delete it.
- The local test server is `static-site` (`preview_start`, port 5510, reachable from the user's phone at `http://<LAN IP>:5510`). Restart it after stopping so the user can test on their phone.
- Use the in-app confirm patterns, never `window.confirm`/`alert`.
- Commit messages: end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`; no double quotes inside a PowerShell `git commit -m @'...'@` message (they split into extra arguments).
- The Gemini API is paid (prepaid credits). Don't run scorecard photos through it repeatedly; use the saved fixtures (`scorecard-test-data*.json`, local only).
- Install CLI tools as local devDependencies, not global npm.
- Keep `PROJECT_BRIEF.md` current when features change, and keep replies short.
