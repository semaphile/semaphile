# Draft plan — release metadata pipeline (synthetic eval fixture)

Status: draft. One open decision below needs a user interview.

## Background

We ship build artifacts through a promotion pipeline. Each release
carries a manifest; consumers resolve artifacts through the descriptor
and verify provenance before install. The pipeline currently emits all
three on every publish, but where the descriptor lives is undecided,
and that decision blocks the publisher implementation.

## Open decision (interview the user)

Where should the descriptor live?

- Option A: embed the descriptor in the manifest, so one document
  travels through the pipeline and provenance covers both at once.
- Option B: keep the descriptor detached as a sidecar, with provenance
  recorded per-file in a separate attestation channel.
