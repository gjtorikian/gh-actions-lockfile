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
gh-actions-lockfile generate
```

This scans all workflow files in `.github/workflows/` and creates `actions.lock.json` with pinned versions for every action, including transitive dependencies from composite actions.

**Options**:

| Option | Description | Default |
|--------|-------------|---------|
| `--require-sha` | Require all action refs to be full SHAs | `false` |

Use `--require-sha` to enforce that all action references use full 40-character commit SHAs instead of tags or branches.

## verify

Verifies that your workflow files match the lockfile. Use this in CI to catch any unexpected changes to your actions.

```bash
gh-actions-lockfile verify
```

The verify command performs four checks:
1. **Lockfile match**: Ensures workflow actions match lockfile entries
2. **SHA verification**: Confirms tags still resolve to the locked commit SHAs
3. **Integrity verification**: Re-downloads tarballs and verifies SHA256 hashes
4. **Advisory check**: Queries GitHub Advisory Database for known vulnerabilities

**Options**:

| Option | Description | Default |
|--------|-------------|---------|
| `-c, --comment` | Post PR comment on verification failure | `true` |
| `--skip-sha` | Skip SHA resolution verification | `false` |
| `--skip-integrity` | Skip integrity hash verification | `false` |
| `--skip-advisories` | Skip security advisory checking | `false` |

Use `--no-comment` to disable PR comments.
Use `--skip-sha`, `--skip-integrity`, or `--skip-advisories` for faster verification (less secure).

**Exit codes**:

- `0` - All actions match the lockfile and integrity checks pass
- `1` - Mismatch detected (action added, removed, or changed) or integrity check failed

When verification fails, the output shows exactly what changed. If running in a PR context with comments enabled, a comment is automatically posted to the PR detailing the mismatches.

## list

Visualizes the actions dependency structure as a tree. Useful for understanding what actions your workflows depend on, including transitive dependencies.

```bash
gh-actions-lockfile list
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
