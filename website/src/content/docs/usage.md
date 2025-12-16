---
title: Usage
description: The recommended workflow for using gh-actions-lockfile to secure your GitHub Actions.
order: 2
---

# Usage

This guide walks through the recommended workflow for integrating gh-actions-lockfile into your project.

## Step 1: Generate Your Initial Lockfile

Run the action in `generate` mode to create your lockfile:

```yaml
name: Generate Lockfile
on: workflow_dispatch

jobs:
  generate:
    runs-on: ubuntu-latest
    permissions:
      # Gives the default GITHUB_TOKEN write permission to commit and push the
      # added or changed files to the repository.
      contents: write

    steps:
      - uses: actions/checkout@v6

      - uses: gjtorikian/gh-actions-lockfile@v1
        with:
          mode: generate

      - name: Commit lockfile
        # Commit the changed lockfile back to the repository
        uses: stefanzweifel/git-auto-commit-action@v7
        # or, something like
        # run: |
        #   git add .github/workflows/actions.lock.json
        #   git commit -m "Add actions lockfile"
        #   git push
```

Or locally with the CLI:

```bash
npx gh-actions-lockfile generate
git add .github/workflows/actions.lock.json
git commit -m "Add actions lockfile"
```

You really only need to generate this initial lockfile once, so choose whichever version makes the most sense.

## Step 2: Step 2: Verify on Every Action Run

Add verification to your CI workflow. If verification fails, the lockfile is automatically regenerated and committed to the PR:

```yaml
name: Verify Actions
# change this to whichever events matter to you
on: [pull_request]

jobs:
  verify-actions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: gjtorikian/gh-actions-lockfile@v1
        with:
          mode: verify

  update-lockfile:
    needs: verify-actions
    if: failure()
    runs-on: ubuntu-latest
    permissions:
      # Gives the default GITHUB_TOKEN write permission to commit and push the
      # added or changed files to the repository.
      contents: write
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ github.head_ref }}

      - uses: gjtorikian/gh-actions-lockfile@v1
        with:
          mode: generate

      - uses: stefanzweifel/git-auto-commit-action@v7
        with:
          commit_message: "Update actions lockfile"
          file_pattern: ".github/workflows/actions.lock.json"
```

When you update an action version (e.g., `actions/checkout@v4` to `@v5`), _or if the action ref changes_ outside of your control, the verify job will fail, triggering the update job to regenerate and commit the lockfile to your PR automatically.

### Manual Updates

If you prefer to update the lockfile locally instead of auto-committing via GitHub Actions, you can:

1. Make your workflow changes
2. Regenerate the lockfile:
   ```bash
   npx gh-actions-lockfile generate
   ```
3. Review the lockfile diff to confirm expected changes
4. Commit both the workflow and lockfile changes together

## When Verification Fails Unexpectedly

If `verify` fails, but you didn't change any actions, investigate:

- **New dependency detected**: A composite action you use added a new transitive dependency
- **SHA mismatch**: An upstream maintainer force-pushed or retagged a version (this is a potential supply chain concern)
- **Missing action**: An action was removed from your workflow but is still in the lockfile

For unexpected changes, review the upstream action's commit history before regenerating the lockfile.
