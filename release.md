# Release Process

This project uses [release-please](https://github.com/googleapis/release-please) to automate releases based on [Conventional Commits](https://www.conventionalcommits.org/).

## Commit Message Format

Commit messages determine how versions are bumped:

| Commit Type                    | Example                       | Version Bump          |
| ------------------------------ | ----------------------------- | --------------------- |
| `feat:`                        | `feat: add dark mode support` | Minor (0.1.0 → 0.2.0) |
| `fix:`                         | `fix: resolve editor crash`   | Patch (0.1.0 → 0.1.1) |
| `feat!:` or `BREAKING CHANGE:` | `feat!: redesign API`         | Major (0.1.0 → 1.0.0) |
| `docs:`, `chore:`, `test:`     | `docs: update README`         | No release            |

## Release Flow

1. **Create a feature branch** and make changes
2. **Use conventional commit messages** for all commits
3. **Open a PR** and merge to `main`
4. **release-please creates a Release PR** automatically
   - This PR accumulates changes and updates the changelog
   - Multiple merges to `main` will update the same Release PR
5. **Review and merge the Release PR** when ready to release
6. **A GitHub Release is created** with a git tag
7. **The publish workflow triggers** and publishes to npm

## Workflows

### `release-please.yml`

- Triggers on every push to `main`
- Creates/updates a Release PR with pending changes
- When the Release PR is merged, creates a GitHub Release and git tag

### `publish.yml`

- Triggers when a GitHub Release is published
- Builds the package and publishes to npm with provenance
