# Agent Workflow

## Commit, Push, Deploy

- Before committing, run `git status --short --branch`, review relevant diffs, and check recent commit style with `git log --oneline -5`.
- Stage all intended tracked and untracked files, but do not commit secrets such as `.env*`, credentials, tokens, or key material.
- Use Conventional Commits for every commit: `type(optional-scope): concise imperative description`.
- After each commit, verify `git status --short --branch`, then push to the tracked remote when the branch is ahead.
- For production frontend checks, rely on the Git-triggered Vercel deployment after pushing `main`; avoid deploying from a dirty local tree unless explicitly requested.
- Verify Vercel with `npx vercel@latest ls <project>` until the newest production deployment is `Ready` or `Error`.
- If Vercel fails, inspect logs with `npx vercel@latest inspect <deployment-url> --logs`, fix the blocker in a new Conventional Commit, push, and re-check deployment.
- In the final update, include commit hash(es), deployment URL, deployment status, and any files intentionally left uncommitted.
