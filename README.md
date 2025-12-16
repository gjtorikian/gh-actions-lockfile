# gh-actions-lockfile

Generate and verify lockfiles for GitHub Actions dependencies. Pins all actions (including transitive dependencies) to the exact commit SHAs with integrity hashes.

## Why?

GitHub Actions has no native lockfile mechanism. Version tags like `@v4` can be silently retagged, and composite actions pull in transitive dependencies you can't see. This tool fixes that.

See "[GitHub Actions Has a Package Manager, and It Might Be the Worst](https://nesbitt.io/2025/12/06/github-actions-package-manager.html)" for more information.

## Recommended Workflow

### Step 1: Generate Your Initial Lockfile

Run an action in `generate` mode to create your lockfile:

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

Or, locally with the CLI:

```bash
npx gh-actions-lockfile generate
git add .github/workflows/actions.lock.json
git commit -m "Add actions lockfile"
```

You really only need to generate this initial lockfile once, so choose whichever version makes the most sense.

### Step 2: Verify on Every Action Run

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

#### Manual Updates

If you prefer to update the lockfile locally instead of auto-committing via GitHub Actions, you can:

1. Make your workflow changes
2. Regenerate the lockfile:
   ```bash
   npx gh-actions-lockfile generate
   ```
3. Review the lockfile diff to confirm expected changes
4. Commit both the workflow and lockfile changes together

### When Verification Fails Unexpectedly

If `verify` fails, but you didn't change any actions, investigate:

- **New dependency detected**: A composite action you use added a new transitive dependency
- **SHA mismatch**: An upstream maintainer force-pushed or retagged a version (this is a potential supply chain concern)
- **Missing action**: An action was removed from your workflow but is still in the lockfile

For unexpected changes, review the upstream action's commit history before regenerating the lockfile.

## Usage

### GitHub Action (recommended)

Add this action to your workflow to verify the lockfile:

```yaml
- uses: gjtorikian/gh-actions-lockfile@v1
  with:
    mode: verify # or 'generate'
```

### Via the CLI

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

> [!WARNING]
> When running locally, set a `GITHUB_TOKEN` environment variable to avoid rate limits. Without it, you're limited to 60 API requests per hour. A personal access token with no special scopes is sufficient for public repositories.
>
> ```bash
> export GITHUB_TOKEN=ghp_your_token_here
> ```

### Commands

#### `generate`

Generates (or updates) the lockfile. You'll always want to do this first.

#### `verify`

Verifies that the lockfile hasn't changed.

#### `list`

Visualizes the actions dependency structure, like:

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

### Options

```
-w, --workflows <path>  Path to workflows directory (default: .github/workflows)
-o, --output <path>     Path to lockfile (default: .github/workflows/actions.lock.json)
-t, --token <token>     GitHub token (or use GITHUB_TOKEN env var)
```

## Lockfile Format

```jsonc
{
  "version": 1,
  "generated": "2025-12-15T20:37:39.422Z",
  "actions": {
    "actions/checkout": [
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
    ]
  }
}
```

## Development

Requires [Bun](https://bun.sh) for building:

```bash
# Clone and install
git clone https://github.com/gjtorikian/gh-actions-lockfile.git
cd gh-actions-lockfile

# Install dependencies
bun install

# Run in development
bun run src/index.ts generate

# Build for distribution
bun run build

# Type check
bun run typecheck

# Run tests
bun test
```
