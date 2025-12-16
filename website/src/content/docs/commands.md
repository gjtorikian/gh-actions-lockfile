---
title: Commands
description: Reference for all gh-actions-lockfile commands.
order: 3
---

# Commands

gh-actions-lockfile provides three main commands for managing your lockfile.

## generate

Generates (or updates) the lockfile from your workflow files. Run this first to create your initial lockfile, and again whenever you intentionally update action versions.

```bash
node dist/cli.js generate
```

This scans all workflow files in `.github/workflows/` and creates `actions.lock.json` with pinned versions for every action, including transitive dependencies from composite actions.

## verify

Verifies that your workflow files match the lockfile. Use this in CI to catch any unexpected changes to your actions.

```bash
node dist/cli.js verify
```

Exit codes:
- `0` - All actions match the lockfile
- `1` - Mismatch detected (action added, removed, or changed)

When verification fails, the output shows exactly what changed.

## list

Visualizes the actions dependency structure as a tree. Useful for understanding what actions your workflows depend on, including transitive dependencies.

```bash
node dist/cli.js list
```

Example output:

```
actions.lock.json (generated 2025-12-15 21:57:33)

├── actions/checkout@v6 (8e8c483db84b)
├── gjtorikian/actions/setup-languages@main (923ecf42f98c)
│   ├── ruby/setup-ruby@v1 (ac793fdd38cc)
│   ├── actions/setup-node@v4 (49933ea5288c)
│   ├── denoland/setup-deno@v1 (11b63cf76cfc)
│   ├── dtolnay/rust-toolchain@master (0b1efabc08b6)
│   └── Swatinem/rust-cache@v2 (779680da715d)
├── actions/cache@v4 (0057852bfaa8)
├── actions/configure-pages@v4 (1f0c5cde4bc7)
├── actions/upload-pages-artifact@v3 (56afc609e742)
│   └── actions/upload-artifact@v4 (ea165f8d65b6)
├── actions/deploy-pages@v4 (d6db90164ac5)
└── googleapis/release-please-action@v4 (16a9c90856f4)
```

The tree shows:
- Each action with its version tag
- The short SHA (first 12 characters) of the pinned commit
- Transitive dependencies indented under their parent action
