# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Documentation

Detailed documentation lives in `.claude/docs/`. Each file declares its primary audience, but any agent may read any file when needed.

| File | Primary Audience | Content |
|------|-----------------|---------|
| `.claude/docs/architecture.md` | Planner, Reviewer | Project overview, source layout, escrow flow, state machine |
| `.claude/docs/packages.md` | Developer, Planner, Reviewer | Modules reference, routes, libraries |
| `.claude/docs/conventions.md` | Developer, Reviewer | TypeScript conventions, Hono patterns, encoding, imports |
| `.claude/docs/environment.md` | All agents | Commands, runtime environment, infrastructure |

## Language

All written output must be in **English**: code comments, agent task files, documentation, review reports, commit messages, and responses to the user. This applies regardless of the language used in the request prompt.
