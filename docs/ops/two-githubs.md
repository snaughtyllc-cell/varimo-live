# Two GitHubs — Lab vs Live

**Status:** Lab repo is this one. Live GitHub (`snaughtyllc-cell/varimo-live`)
is created empty, then seeded — not merged.

Same-repo branches (`tier1` vs `cursor/railway-runpod-split-c975`) are how
Studio UI and engine work keep getting **dropped**. A merge is Git combining
two histories; whichever side “wins” a file, the other side is gone. Two
GitHubs means that merge is not a thing. Promotion is **copy chosen files**,
commit on Live.

## The two GitHubs

| | **Lab** | **Live** |
|---|---|---|
| GitHub | `snaughtyllc-cell/variant-maker` | `snaughtyllc-cell/varimo-live` |
| Default branch | `tier1` | `main` |
| Who | Jeff + agents experimenting | Testers + production Studio |
| Fast image | `variant-fast:lab` | digest-pinned `variant-fast:latest` |
| Railway | lab / staging only | `varyforge-studio-production` |
| Promote | — | copy files from Lab, never `git merge` |

Machine-readable: `varimo-lane.json` (this checkout). Live template:
`deploy/varimo-lane.live.json`.

## What this changes (effects)

1. **UI/engine stop getting overwritten by merges.** Lab can redesign. Live
   stays on its own history until you copy a specific change over.
2. **Live UI stays as it is until you redesign it on Live.** Lab design does
   not flow over automatically. That is the point. Next step after cutover:
   fix Live UI **in `varimo-live`**, not by merging Lab.
3. **Two Cursor Cloud environments.** “Fix testers / live Studio” agents must
   open **varimo-live**. Lab experiments stay here. One agent on this repo
   cannot ship testers by merging a branch.
4. **Railway reconnect once.** Production today tracks
   `variant-maker` / `cursor/railway-runpod-split-c975`. After seed, point
   that service at **varimo-live** / `main`. Until you do, GitHub split
   does not change what testers see.
5. **Two CI pipelines.** Lab Fast builds `:lab` only. Live Fast `:latest`
   belongs on varimo-live after cutover. Do not push `:latest` from Lab
   after cutover.
6. **A bugfix needed in both places is copied twice** (or
   `scripts/promote-to-live.sh` then a Live commit). No automatic backport.
7. **Open Live PRs on this repo** (anything targeting
   `cursor/railway-runpod-split-c975`) stay until seed; then cherry-pick
   onto varimo-live. Do not merge Lab `tier1` into that Live branch to
   “sync.”
8. **Secrets stay on Railway / RunPod**, not in git. GHCR images can stay
   `ghcr.io/snaughtyllc-cell/variant-fast`. Grant the new repo `packages:
   write` (or keep publishing from Live Actions).
9. **Cursor GitHub App + Railway GitHub App** must be installed on
   `varimo-live`. A token that can only see `variant-maker` cannot push
   the seed.
10. **Fast CPU endpoints do not change** just because GitHub split. Lab
    Fast vs Live Fast is still `docs/ops/lab-fast.md`. Do not PATCH live
    Fast to test Lab.

## Create Live GitHub (one click)

This agent cannot create GitHub repos (read-only `gh`).

1. https://github.com/new
2. Owner **snaughtyllc-cell**, name **varimo-live**
3. **Empty** — no README, no `.gitignore`, no license
4. Install the **Cursor** GitHub App on `varimo-live` (same as this repo)
5. Tell the agent “varimo-live exists” — then:

```bash
LIVE_REMOTE=https://github.com/snaughtyllc-cell/varimo-live.git ./scripts/seed-live-repo.sh
```

That pushes today’s Live Studio branch
(`cursor/railway-runpod-split-c975`) to `varimo-live` `main` and writes
the Live lane file. It does **not** merge Lab `tier1`.

6. Railway: production GitHub source → `varimo-live` `main`
7. New Cursor Cloud environment whose repo is `varimo-live`

## Copy something to Live (not merge)

```bash
./scripts/promote-to-live.sh web/app/page.tsx web/app/globals.css
# unpack dist/promote-to-live.tgz on a varimo-live checkout, commit there
```

## Do not

- `git merge tier1` into Live (or the old Live branch)
- `git merge` Live into Lab to “get the design back”
- Ship testers from `variant-maker`
- Treat a Lab PR as a production deploy
