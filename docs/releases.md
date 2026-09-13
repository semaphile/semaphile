# Releases

Semaphile 0.1.0 is an experimental MIT-licensed release. All three packages share
one version and use exact matching Semaphile peer versions. See the
[changelog](../CHANGELOG.md) for features and compatibility boundaries.

## Install the release archives

Download the assets from [v0.1.0](https://github.com/semaphile/semaphile/releases/tag/v0.1.0)
and verify them against `SHA256SUMS`. The repository and release assets are public.
The original GitHub archives are distinct from the npm publication archives.

```sh
# macOS
shasum -a 256 -c SHA256SUMS
# Linux: sha256sum -c SHA256SUMS

npm install --ignore-scripts ./semaphile-core-0.1.0.tgz \
  ./semaphile-redis-0.1.0.tgz ./semaphile-messaging-0.1.0.tgz
```

Install only the packages you need: core is standalone; Redis requires core;
messaging's core and Redis peers are optional and enable pool administration.
Redis's external JavaScript dependencies are fetched by npm unless cached.

Core and messaging each include the same verified native targets: `darwin-arm64`
and `linux-x64`. The Redis package contains TypeScript-generated JavaScript and
Lua with no native addon. The explicit core memory entry point does not load
SQLite or native code. Node >=22.18 is required; runtime verification includes
Node 22.23/Linux, Node 26.7/macOS and Bun 1.4.2 on both platforms. A tested version
does not establish support for all future versions or other architectures.

## Maintainer release process

1. Merge reviewed changes and update the three package manifests, lockfiles and
   exact peer versions together. Update the changelog and release identity.
2. Build the same commit on macOS arm64 and Linux x64. Keep native source and
   binary hashes with each target. Never reuse an artifact whose source hash
   differs; see [portable archive verification](testing.md#native-headers-and-portable-archives).
3. Assemble both real native targets into core and messaging, then pack the three
   packages with `npm pack --ignore-scripts`. This does not publish to a registry.
4. Test those exact archives on both platforms under Node and Bun. Include
   installed-consumer, native-header, license, version and privacy checks.
5. Create `SHA256SUMS` and `release.json` with the source commit, package hashes
   and native target identities. Preserve the verified archives without repacking.
6. Tag the verified commit `vX.Y.Z`, push main and the tag, and attach the verified
   assets and release notes to its GitHub release.

The root development package and Rust crates remain private. The three npm
packages declare public access and the npm registry explicitly. Registry
publication is a separate maintainer step.

## First npm publication

The npm package names are `@semaphile/core`, `@semaphile/redis` and
`@semaphile/messaging`, all at `0.1.0`. Their manifests are prepared for public
publication; availability is confirmed only after the registry accepts them.
The maintainer needs an npm account with publishing rights in the `semaphile`
organization. GitHub and npm organizations are separate.

The original `v0.1.0` GitHub archives retain `private: true`. Preserve those
archives and the tag. To prepare npm archives, unpack each verified GitHub
archive into a separate staging directory. Replace only its `package.json`
and `README.md` with the reviewed publication metadata from this repository,
then run `npm pack --ignore-scripts` on that staging directory. Verify that
all other files, including both native targets and the CLI executable mode,
match the original archive. No native rebuild is needed for this metadata change.

Keep these separately verified npm archives in `releases/0.1.0-npm`, with
`SHA256SUMS` and `release.json` recording their metadata commit, the original
runtime commit, and archive hashes. Run the installed-consumer tests on these
exact files under Node and Bun on macOS and Linux before publication. Never
publish an arbitrary local build that may contain only one native target.

From the repository root, the maintainer publishes the verified archives in
peer dependency order:

```sh
npm login --registry=https://registry.npmjs.org
(cd releases/0.1.0-npm && shasum -a 256 -c SHA256SUMS)
npm publish ./releases/0.1.0-npm/semaphile-core-0.1.0.tgz --access public --ignore-scripts
npm publish ./releases/0.1.0-npm/semaphile-redis-0.1.0.tgz --access public --ignore-scripts
npm publish ./releases/0.1.0-npm/semaphile-messaging-0.1.0.tgz --access public --ignore-scripts
```

These commands upload packages; add `--dry-run` to inspect publication without
uploading. Complete any npm authentication challenge in your terminal. After
publication, verify each registry version and integrity value, then install the
registry packages in a clean consumer. Once all three are available:

```sh
npm install @semaphile/core@0.1.0 @semaphile/redis@0.1.0 @semaphile/messaging@0.1.0
# Or, for Bun projects:
bun add @semaphile/core@0.1.0 @semaphile/redis@0.1.0 @semaphile/messaging@0.1.0
```

Future automated releases can use npm's
[trusted publishing](https://docs.npmjs.com/trusted-publishers/) from GitHub
Actions. Configure the trusted workflow in each package's npm settings when
that workflow is implemented. This first release uses manual publication; it
does not install a workflow or store a publishing token in the repository.
