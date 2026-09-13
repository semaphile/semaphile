#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
umask 077
node --no-warnings packages/core/build.mjs
node --no-warnings conformance/typescript/test.mjs
