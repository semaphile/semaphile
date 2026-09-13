# Releases

Semaphile 0.1.0 is an experimental MIT-licensed release. All three packages share
one version and use exact matching Semaphile peer versions. See the
[changelog](../CHANGELOG.md) for features and compatibility boundaries.

## Install the release archives

Download the assets from [v0.1.0](https://github.com/semaphile/semaphile/releases/tag/v0.1.0)
and verify them against `SHA256SUMS`. Repository access is required while the
GitHub repository is private. The archives are not npm registry publications.

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

The root development package and Rust crates remain private. The npm package
manifests also retain their current `private` publication guard: the maintainer
owns a separate registry-publication step. No release command here publishes to
npm or changes repository visibility.
