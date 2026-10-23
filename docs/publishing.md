# Publish to npm

The release workflow is `.github/workflows/publish.yml`. It runs only for pushed tags that start with `v`, such as `v0.9.1`. A push to `main` does not publish a package.

The workflow checks that the tag matches a stable version in `package.json` and points to a commit on `main`. It then installs dependencies, runs the checks and tests, builds the plugin, and checks the package contents before publishing.

## 1. Create the GitHub approval gate

In [repository settings](https://github.com/codefriendly/openclaw-tinyfish/settings/environments), create an environment named **`npm`**.

- Add yourself as a required reviewer.
- Allow release tags that match `v*` under deployment branches and tags.
- Do not add an npm token. This workflow uses npm trusted publishing.

The environment name alone does not require approval. Set the required reviewer before you push a release tag. With one maintainer, leave **Prevent self-review** off so you can approve your own release.

## 2. Connect npm to GitHub Actions

Version `0.9.0` was published manually. Do not push a `v0.9.0` tag to run this workflow: npm does not let you replace a published version. Use a new version for the first GitHub Actions release.

First make sure `publish.yml` is on the repository's `main` branch. Then open the [npm package settings](https://www.npmjs.com/package/openclaw-tinyfish/access) and add a **GitHub Actions** trusted publisher with these exact values:

| Field | Value |
| --- | --- |
| Organization or user | `codefriendly` |
| Repository | `openclaw-tinyfish` |
| Workflow filename | `publish.yml` |
| Environment name | `npm` |
| Allowed action | Allow `npm publish` |

Enter the workflow filename only, not `.github/workflows/publish.yml`. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed. npm generates provenance automatically for trusted publishing from this public repository.

Create the trusted publisher shortly before the next release. A new configuration expires if it does not complete its first successful publish within two days. After a successful OIDC release, consider setting npm publishing access to **Require two-factor authentication and disallow tokens**.

## 3. Publish a new version from GitHub

Update the version in `package.json`, `package-lock.json`, the README's versioned install example, and `CHANGELOG.md`. Commit and push the release changes to `main`. Then create and push the matching tag. For example, after updating the package to `0.9.1`:

```sh
git tag v0.9.1
git push origin v0.9.1
```

The tag push starts the release workflow. Approve its `npm` environment job in GitHub Actions. The workflow runs the checks before publishing. Check the workflow result and the npm package page after it finishes.

The workflow rejects prerelease versions. Add a separate release path with an npm distribution tag such as `next` before publishing prereleases. This workflow publishes stable releases to npm's default `latest` tag.

## Security and limits

- The workflow uses GitHub-hosted runners and a short-lived OIDC identity, not a saved npm token.
- The GitHub Actions versions are pinned to commit IDs.
- Release jobs do not use dependency caches.
- The known OpenClaw dependency audit findings are not suppressed or repaired by this workflow. Review them separately; passing tests does not mean the dependency tree has no vulnerabilities.
- You can review and restrict who can create `v*` tags with a GitHub repository ruleset.

See npm's [trusted publishing guide](https://docs.npmjs.com/trusted-publishers/) for setup details and current requirements.
