# Public and private documentation

“Public” here means prepared for inclusion in the source repository or future
documentation site. This change does not publish files or packages anywhere.

| Material                                                       | Destination                                             | Reason                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| Usage, setup and API limitations                               | Root and package READMEs                                | Useful to every consumer                                    |
| Current architecture, blocking protocol, rationale and testing | `docs/`                                                 | Useful to contributors without session context              |
| Authoritative behavior                                         | `SPEC.md`                                               | Required to assess implementation changes                   |
| Historical interviews and research                             | `.scratch/docs/decisions.md`, `.scratch/docs/research/` | Contains proposals, superseded choices and internal context |
| Session handoffs and completion records                        | `.scratch/docs/handoffs/`, `.scratch/docs/PROGRESS.md`  | Maintainer working history                                  |
| Raw test receipts, review output and scan exports              | `.scratch/docs/receipts/`, `.scratch/docs/reviews/`     | Includes machine paths, hosts and development metadata      |
| Internal application integration notes                         | `.scratch/docs/`                                        | Specific to a private consumer                              |

The original records were moved intact. Their embedded paths and commands remain
historical evidence rather than being rewritten to resemble current instructions.
The previous blocking narrative is retained privately; the public blocking guide
describes the current implementation. Durable rationale from research is curated
into public design notes rather than exposing raw research logs.

The private tree, credentials and generated artifacts are excluded by `.gitignore`.
Ignoring a directory is a packaging convention, not access control and not removal
from any previously published history. Any future site/export should explicitly
select the public docs and avoid recursively copying the entire workspace.

Public Markdown links must resolve without access to private records. Run
`npm run check:docs` before publishing or moving documentation. Examples should
use configurable endpoints and generic paths. Release artifacts remain a
separate maintainer workflow.
