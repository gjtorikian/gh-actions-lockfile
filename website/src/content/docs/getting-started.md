---
title: Getting Started
description: Learn how to set up gh-actions-lockfile to secure your GitHub Actions workflows.
order: 1
---

# Getting Started

**gh-actions-lockfile** generates and verifies lockfiles for GitHub Actions dependencies. It pins all actions (including transitive dependencies) to exact commit SHAs with integrity hashes.

## Why Use a Lockfile?

GitHub Actions has no native lockfile mechanism. This creates several security and reliability concerns:

- **Mutable version tags**: Version tags like `@v4` can be silently retagged to point to different code
- **Hidden dependencies**: Composite actions pull in transitive dependencies you can't see or audit
- **No integrity verification**: There's no built-in way to verify that the action code hasn't changed

For more background, see "[GitHub Actions Has a Package Manager, and It Might Be the Worst](https://nesbitt.io/2025/12/06/github-actions-package-manager.html)".

## Quick Start

### Option 1: As a GitHub Action (recommended)

Add verification to your CI workflow:

```yaml
- uses: gjtorikian/gh-actions-lockfile@v1
  with:
    mode: verify # or 'generate'
```

#### Permissions for PR Comments

When using `verify` mode with the `comment: true` option (default), the action posts a comment on pull requests if verification fails. This requires write permissions:

```yaml
permissions:
  pull-requests: write

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: gjtorikian/gh-actions-lockfile@v1
        with:
          mode: verify
```

Without these permissions, you'll see: `Resource not accessible by integration`.

### Option 2: Via the CLI

Install globally via npm:

```bash
npm install -g gh-actions-lockfile
```

Then run:

```bash
# Generate a lockfile from your workflows
gh-actions-lockfile generate

# Verify workflows match the lockfile (exits 1 on mismatch)
gh-actions-lockfile verify

# Show dependency tree
gh-actions-lockfile list
```

Or use `npx` without installing:

```bash
npx gh-actions-lockfile generate
```

## What's in the Lockfile?

The lockfile pins each action to:

- **SHA**: The exact Git commit hash
- **Integrity**: A SHA-256 hash of the action's content
- **Dependencies**: Any transitive dependencies from composite actions

```jsonc
{
  "version": 1,
  "generated": "2025-12-15T20:37:39.422Z",
  "actions": {
    "actions/checkout": [
      {
        "version": "v4",
        // This is the Git commit SHA (the 40-character hex hash).
        // It identifies the exact commit in the action's repository that will be checked out.
        // It answers: "which version of the code should I fetch?"
        "sha": "11bd71901bbe5b1630ceea73d27597364c9af683",
        // This is a Subresource Integrity (SRI) hash of the action's content (using SHA-256).
        // It answers: "is the content I fetched what I expected?"
        "integrity": "sha256-abc123...",
        // This tracks transitive dependencies — other GitHub Actions that a composite action uses internally.
        "dependencies": []
      }
    ]
  }
}
```

## Next Steps

- [Usage](/docs/usage) - Learn the recommended workflow for generating and verifying lockfiles
- [Commands](/docs/commands) - Explore all available commands
- [CLI Reference](/docs/cli-reference) - See all CLI options and environment variables
