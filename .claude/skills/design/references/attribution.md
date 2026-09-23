# Attribution

This skill crosses two upstreams. Neither is vendored here; the first is
called by pinned version, the second is ported in a later step.

## 1. impeccable — the craft method

[pbakaus/impeccable](https://github.com/pbakaus/impeccable) by Paul
Bakaus, Apache-2.0. The design skill pack whose CLI, compiled engine and
playbooks (`SKILL.md`, `reference/*.md`, the detector rules) evie-kit
calls by reference at a pinned release. The selected release is named in
`packages/design/instrument/impeccable.json` (CLI 4.1.0, engine 0.1.5,
skill 4.3.0, release commit `73a6f51a`), acquired into the verified store
and verified file by file. Nothing of impeccable's method is
re-implemented here: the drift model at
`docs/research/tooling/impeccable-intent-drift-2026-09.md` records why
(weekly code-heavy releases; the 2026-09-04 move from a Node script tree
to a downloaded compiled engine). What evie-kit owns is the glue — the
expected-identity file, the acquisition and verification protocol, the
setup rows, and later the diff-scoped gates and the advisory channel.

## 2. intent — the purpose method

[ghaida/intent](https://github.com/ghaida/intent), CC0-1.0. A design
strategy skill system: a context-gathering protocol (who is this for,
why does it exist), a principle set and anti-pattern catalog, and a
router over fifteen skills. Its protocol is PORTED (not called) in the
map's onboarding ticket, starting from the context protocol. The pilot in
a consumer repository (2026-08, reconstructed at that ticket's start)
found the protocol earned its place while the router still has to. The
CC0 dedication makes the port lawful without a notice; this file carries
the credit anyway, because the idea is theirs.

## What evie-kit adds

The three-layer shape (upfront decisions, gates inside goals, the
method) is evie-kit's own framing, decided at the EVA-229 grill
(2026-09-16). The verified asset store under `~/.evie-kit/assets/` and
the expected-identity contract (ADR 0024) are evie-kit's, replacing the
vendored-tree determinism contract of EVA-121.
