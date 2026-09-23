/**
 * Dominance-aware healing plus the etiquette step (EVA-106).
 *
 * The heal itself is mechanical. What is NOT mechanical — and what this
 * file keeps as an explicit gate rather than a policy flag — is
 * overwriting something a human wrote. That branch produces a drafted
 * comment and stops.
 */

import {
  blockText,
  diffBlocks,
  dominanceFor,
  markdownToBlocks,
  renderCommentRichText,
  richTextDigest,
  type AfterBlock,
  type DiffOp,
  type DominanceMap,
  type NotionClient,
} from "@evie-kit/notion";
import type { BlockChild } from "@evie-kit/notion/basic-memory";
import type { MirrorStatus } from "./mirror-status.js";

export type HealClient = Pick<
  NotionClient,
  "listBlocks" | "applyBlockOps" | "createComment"
>;

/**
 * A local-dominant mirror claims the body. Everything it does not claim
 * falls back to `"notion"` (`DEFAULT_FIELD_DOMINANCE`) — a human edit to
 * an unclaimed field is treated as intentional, which is the safe default
 * and the reason to be explicit about what you DO claim.
 */
export const MIRROR_DOMINANCE: DominanceMap = { body: "local", title: "local" };

export type Disposition = "superseded" | "whitespace-only" | "substantive";

/**
 * The dispositions a MACHINE may assign. `"superseded"` is deliberately
 * absent (results-002 codex): deciding that incoming text carries a
 * human's edit forward is a semantic judgement, and the cheap proxy for
 * it — substring containment — authorizes exactly the overwrite this flow
 * exists to prevent. `{ base: "pending", remote: "approved", local: "not
 * approved" }` satisfies containment while reversing the human's meaning.
 *
 * `"superseded"` remains in the type because it is a legitimate TRIAGE
 * outcome; it just has to come from whoever read both texts.
 */
export type InferredDisposition = Extract<
  Disposition,
  "whitespace-only" | "substantive"
>;

/**
 * Classify one remote change. This function decides exactly ONE thing:
 * whether the remote BLOCK and the block this heal would publish are the
 * same block modulo insignificant whitespace. Everything else is
 * `substantive`.
 *
 * That narrowness is the point, and it was learned three times — each
 * time by using a cheaper projection than the question deserved. Judging
 * remote-vs-local text alone made an emptied paragraph "already covered",
 * because an empty string is contained in everything (results-001).
 * Adding the base fixed that case and left the real one: containment is
 * not evidence of supersession at all — `{ base: "pending", remote:
 * "approved", local: "not approved" }` passes every containment check
 * while reversing what the human said (results-002). Dropping containment
 * for plain-text equality left the third: plain text cannot see a changed
 * link destination, a new emphasis, or a code block's language, so those
 * edits classified as whitespace and healed away unasked (results-003).
 *
 * It takes BLOCKS rather than strings for that reason. A string argument
 * cannot be fixed by being more careful with it — the information needed
 * to answer correctly is not in it.
 *
 * So the failure direction is "ask a human too often", enforced by
 * construction rather than by care: the only automatic pass is provable
 * equivalence of everything the API models.
 */
export function disposition(args: {
  /** The block as it stands now, on the Notion side. */
  remote: BlockChild;
  /** The block this heal would publish in its place. */
  local: BlockChild;
}): InferredDisposition {
  // A changed TYPE is always substantive: a paragraph becoming a heading
  // is a real edit no text comparison can see.
  if (args.remote.type !== args.local.type) return "substantive";
  // Children are invisible to the payload digest, and losing them is a
  // real edit — the same reason `treeRev` carries `has_children`
  // (results-005 coderabbit). Inside `planHeal` the container refusal
  // already closes this path, but this classifier is exported standalone
  // and a caller outside that flow has no such guard.
  const carriesChildren = (block: BlockChild): boolean =>
    (block as { has_children?: boolean }).has_children === true;
  if (carriesChildren(args.remote) !== carriesChildren(args.local)) return "substantive";
  return semanticSkeleton(args.remote) === semanticSkeleton(args.local)
    ? "whitespace-only"
    : "substantive";
}

/**
 * A block's identity with INSIGNIFICANT whitespace removed and everything
 * else left standing — the comparison `disposition` actually needs
 * (results-003 codex).
 *
 * Comparing plain text was the third version of one mistake: a lossy
 * projection used as proof of equivalence. Collapsed text cannot see a
 * link whose destination changed under the same label, a word that gained
 * emphasis, or a code block whose language changed — all real edits, all
 * of which `diffBlocks` emits ops for, and all of which a text comparison
 * waves through as "whitespace-only".
 *
 * So the comparison delegates to `richTextDigest` — the package's OWN
 * equality notion, the one `diffBlocks` uses to decide whether to emit an
 * update. That alignment is the point: "whitespace-only" should mean
 * exactly "the only reason an op would be emitted is whitespace", and a
 * second, independently-written digest would drift from the op generator
 * it is supposed to agree with. It carries links, true annotations, and
 * code language, and it normalizes the two SHAPES a caller really has —
 * API read-back (`plain_text`, `href`, full annotation objects) versus
 * `markdownToBlocks` output (`text.content`, true-only annotations).
 * Rolling that normalization by hand was the results-004 defect: a raw
 * JSON digest called every real pair substantive, so the only automatic
 * disposition never fired outside tests that built both sides the same
 * way.
 *
 * CODE is the exception: whitespace there is not insignificant, so a code
 * block only passes on exact equality. Indentation changes behavior.
 */
function semanticSkeleton(block: BlockChild): string {
  // Squeeze the character data FIRST, then let the package's own digest
  // decide equality. Doing it in this order is what makes the comparison
  // work on the two shapes a caller really has (results-004 codex): a
  // block read back from the API carries `plain_text`, `href` and a full
  // annotation object, while `markdownToBlocks` emits `text.content` and
  // true-only annotations. Comparing those raw — which is what a
  // hand-rolled JSON digest does — reports every real pair as
  // substantive, so the only automatic disposition never fires in
  // production while passing every test built from one synthetic shape.
  const squeezed = block.type === "code" ? block : squeezeBlockText(block);
  // TWO halves, deliberately (results-005 codex — a defect in the
  // results-004 fix): `richTextDigest` normalizes the rich-text runs
  // across their two real shapes, but it reads ONLY rich_text and code
  // language — delegating the whole comparison to it silently dropped
  // every other payload field, so a heading turned toggleable or a block
  // recolored classified as "whitespace-only" and healed away unasked.
  // The rest of the payload is compared with sorted keys and DEFAULTS
  // DROPPED: read-back spells its defaults out (`color: "default"`,
  // `is_toggleable: false`, `caption: []`) while outgoing blocks omit
  // them, and the API treats absence as exactly those values — so a
  // default and its absence must compare equal, the same rule
  // `richTextDigest` applies with its true-only annotations. Everything
  // NON-default survives: a field this code has never heard of is
  // compared by default, which is the fail-closed direction the doc
  // above promises.
  const payload = (squeezed as unknown as Record<string, unknown>)[block.type];
  const rest =
    payload !== null && typeof payload === "object"
      ? nonDefaultJson({ ...(payload as Record<string, unknown>), rich_text: undefined })
      : JSON.stringify(payload ?? null);
  return `${block.type}:${rest}:${richTextDigest(squeezed as AfterBlock)}`;
}

/**
 * JSON with object keys sorted at every depth (key order never reads as a
 * content difference) and Notion's absence-equivalent defaults removed:
 * `undefined`, `false`, `"default"`, and empty arrays all read back where
 * the outgoing shape simply says nothing.
 */
function nonDefaultJson(value: unknown): string {
  const isDefault = (v: unknown): boolean =>
    v === undefined || v === false || v === "default" || (Array.isArray(v) && v.length === 0);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, inner]) => !isDefault(inner))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, inner]) => [key, walk(inner)]),
      );
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/**
 * A copy of the block with each rich-text run's character data collapsed.
 * Both carriers are squeezed because either may be the one present:
 * read-back populates `plain_text`, outgoing populates `text.content`,
 * and `richTextDigest` reads whichever it finds.
 */
function squeezeBlockText(block: BlockChild): BlockChild {
  const squeeze = (text: string): string => text.replace(/\s+/g, " ").trim();
  const record = block as unknown as Record<string, unknown>;
  const payload = record[block.type] as { rich_text?: Array<Record<string, unknown>> } | undefined;
  if (payload?.rich_text === undefined) return block;
  return {
    ...record,
    [block.type]: {
      ...payload,
      rich_text: payload.rich_text.map((run) => {
        const text = run["text"] as { content?: string } | undefined;
        return {
          ...run,
          ...(typeof run["plain_text"] === "string"
            ? { plain_text: squeeze(run["plain_text"]) }
            : {}),
          ...(text?.content !== undefined
            ? { text: { ...text, content: squeeze(text.content) } }
            : {}),
        };
      }),
    },
  } as unknown as BlockChild;
}

export interface HealPlan {
  ops: DiffOp[];
  /** True when applying `ops` would discard human-authored content. */
  overwritesHuman: boolean;
  /** Set when it would: the comment to get approved, then post, then heal. */
  draftComment?: string;
  /**
   * Identity of the live tree the ops were computed against
   * (results-001 coderabbit). Triage, human approval and the write are
   * separated by however long a human takes to answer, and the ops
   * address blocks BY ID — so a block edited in that window would be
   * overwritten by an op nobody approved for its new content. `applyHeal`
   * re-reads the page and refuses if this no longer matches.
   */
  expectedTreeRev: string;
}

/**
 * An identity for a top-level block tree, used to detect a page moving
 * between triage and write.
 *
 * It digests each block's id, TYPE and full type payload — not merely its
 * plain text (results-002 codex). Plain text is blind to a changed link
 * destination, an annotation, a code language, and a paragraph becoming a
 * heading; `diffBlocks` sees all of those and would emit real ops for
 * them, so a text-only revision would call the page unchanged while the
 * plan it guards was already stale.
 *
 * What it still cannot see is container CHILDREN: `listBlocks` reads only
 * top-level blocks, so an edit inside a table cell moves nothing here.
 * That is why `planHeal` refuses container-bearing pages outright rather
 * than trusting this — an undetectable staleness is not a risk to accept
 * quietly.
 */
export function treeRev(blocks: BlockChild[]): string {
  return blocks
    .map((block) => {
      const payload = (block as unknown as Record<string, unknown>)[block.type];
      // `has_children` is part of the identity (results-003 codex). A block
      // that GAINS children between plan and apply is a page that grew
      // content this plan never saw — invisible in the type payload, and
      // the one change that flips a page from heal-able to refuse.
      const children = (block as { has_children?: boolean }).has_children === true;
      return `${block.id}:${block.type}:${children}:${JSON.stringify(payload ?? null)}`;
    })
    .join("\n");
}

/** Notion's read-back marks a container (table, toggle, …) with `has_children`. */
function hasContainers(blocks: BlockChild[]): boolean {
  return blocks.some((block) => (block as { has_children?: boolean }).has_children === true);
}

/** The explanation a human should see when their edit is republished away. */
export function draftHealComment(args: {
  sourcePath: string;
  editedOn: string;
  discardedText: string;
}): string {
  const text =
    `This page is mirrored from \`${args.sourcePath}\` and has just been ` +
    `republished from that source, so the edit made here on ${args.editedOn} ` +
    `is no longer shown. Nothing was lost — it said: "${args.discardedText}". ` +
    `To make that change stick, edit the source file, or reply here and it ` +
    `will be picked up in the next triage.`;
  // Render it the way the API will: this throws on an empty or over-cap
  // draft HERE, rather than after a human has already approved it.
  renderCommentRichText(text);
  return text;
}

/** One remotely-changed block, and what triage decided about it. */
export interface ClassifiedChange {
  blockId: string;
  disposition: Disposition;
}

/**
 * The block ids a remote change set touches. An `append` carries none —
 * a human ADDED a block, which is new remote content by definition and
 * cannot be classified against anything, so it is handled separately as
 * unconditionally substantive.
 */
function changedBlockIds(remoteOps: DiffOp[]): { ids: string[]; humanAdded: boolean } {
  const ids: string[] = [];
  let humanAdded = false;
  for (const op of remoteOps) {
    if (op.op === "append") humanAdded = true;
    else ids.push(op.blockId);
  }
  return { ids: [...new Set(ids)], humanAdded };
}

/**
 * Refuse a plan the API could not execute, BEFORE anything is written
 * (results-001 codex). Notion cannot prepend, and the executor discovers
 * that only when it reaches the null-anchored op — by which point earlier
 * deletes have already landed and the explanatory comment has already
 * posted. A half-healed page with a comment describing a heal that did
 * not happen is the worst state this flow can reach, so the check runs at
 * plan time and again before the first write.
 */
export function preflightOps(ops: DiffOp[], liveBlocks: BlockChild[]): void {
  // An EMPTY page never reaches here: `planHeal` refuses it outright
  // (results-005 codex) — the anchor-less fill path lives in the real
  // upsert writer, NOT in this example's `applyBlockOps`, whose executor
  // rejects every null anchor. The earlier comment here claimed a path
  // that does not exist in this client.
  if (liveBlocks.length === 0) return;
  const blocked = ops.some(
    (op) => (op.op === "append" || op.op === "move") && op.afterBlockId === null,
  );
  if (blocked) {
    throw new Error(
      "this heal needs to insert a block at the very top of the page, and " +
        "Notion's API cannot prepend. Keep the page's first block stable " +
        "(a title heading does this), or patch the new leading content in " +
        "after the current first block and re-plan.",
    );
  }
}

/**
 * Plan a heal: the ops, whether a human has to approve first, and the
 * page state the plan is valid against.
 *
 * The classification is FAIL-CLOSED (results-001 codex). Every remotely
 * changed block must carry a disposition; a missing one, a human-added
 * block, or a page whose containers make the diff undecidable all count
 * as substantive. An unclassified change is not a safe change — it is an
 * unexamined one, and the earlier shape (a bare `Disposition[]` the caller
 * could pass empty) let a fully destructive plan run unattended.
 *
 * It takes the whole `MirrorStatus` rather than a live tree plus a set of
 * ops (results-004 codex). Those were two arguments nothing forced to
 * agree, and the natural composition — triage reads the page, the caller
 * reads it again to pass `liveBlocks` — made them disagree whenever a
 * teammate edited between the two reads. The approval decision came from
 * the OLD ops while the staleness stamp came from the NEW tree, so
 * `applyHeal`'s re-check passed and the edit was overwritten silently:
 * the precise failure this file exists to make impossible. One snapshot,
 * carried by the value that computed it, cannot disagree with itself.
 */
export function planHeal(args: {
  /** Triage's result — the ops AND the snapshot they were computed against. */
  status: MirrorStatus;
  localMarkdown: string;
  /** Triage's verdict per remotely-changed block. */
  classified: ClassifiedChange[];
  sourcePath: string;
  editedOn: string;
  discardedText: string;
  dominance?: DominanceMap;
}): HealPlan {
  // This flow is local-dominant, and the ops say so: they are always
  // "make Notion match local". Under any other body policy those same ops
  // CONTRADICT the policy, so the answer is to refuse — not to apply them
  // with the approval gate switched off, which is what the earlier
  // `bodyIsLocal && …` conjunct did (results-002, both interactive
  // reviewers). The input that most clearly says "the human wins" must
  // not be the one that produces the least-guarded plan.
  const bodyDominance = dominanceFor(args.dominance ?? MIRROR_DOMINANCE, "body");
  if (bodyDominance !== "local") {
    throw new Error(
      `this heal pushes the local body over the remote one, but the body's ` +
        `dominance is "${bodyDominance}" — that policy says Notion wins, so ` +
        "pull instead of healing (an unlisted field defaults to \"notion\", " +
        "so an empty dominance map lands here too)",
    );
  }

  // A status that never read the page carries no snapshot, so there is
  // nothing to plan against and nothing to stamp. Refuse rather than
  // treat "no blocks" as "an empty page", which would plan a full
  // rewrite of a page nobody looked at.
  if (!args.status.candidate) {
    throw new Error(
      "this status is not a candidate — stage one did not fire, so no live " +
        "read was made and there is no snapshot to heal against. Re-run " +
        "status before planning.",
    );
  }
  const liveBlocks = args.status.liveBlocks;

  const desired = markdownToBlocks(args.localMarkdown);

  // The two empty-body refusals the REAL upsert writer makes and this
  // example silently skipped (results-005 codex, the blocker).
  //
  // An empty RENDER against a non-empty page is refused, never planned:
  // the diff would be all deletes, and a truncated or frontmatter-only
  // file is the ordinary way to produce a zero-block render. Without
  // this, a metadata-only bump plus a truncated local file planned a
  // delete-all with `overwritesHuman: false` — no approval, no comment,
  // every body block gone. The CLI path refuses this in
  // `refuseEmptyRender`; an example teaching the library path must not
  // teach the hole.
  if (desired.length === 0 && liveBlocks.length > 0) {
    throw new Error(
      "the local render is EMPTY and the page is not — a truncated or " +
        "frontmatter-only file is the usual cause. Healing would delete " +
        "every block; fix the source file (or empty the page by hand if " +
        "that is truly intended).",
    );
  }
  // An EMPTY page cannot be healed through this client: filling it takes
  // the anchor-less append path (`upsert` / `appendBlocks`), and this
  // example's `applyBlockOps` executor rejects every null anchor — the
  // failure would land AFTER the explanatory comment posted, leaving a
  // comment describing a heal that never happened.
  if (liveBlocks.length === 0 && desired.length > 0) {
    throw new Error(
      "this page is empty — a heal negotiates with existing content, and " +
        "there is none to preserve. Fill an empty page with `notion " +
        "upsert` (the anchor-less append path), then heal from there.",
    );
  }

  const ops = diffBlocks(liveBlocks, desired);
  preflightOps(ops, liveBlocks);

  // Container children are invisible to BOTH the top-level diff and the
  // staleness check (`listBlocks` reads top-level blocks only), so an edit
  // inside a table cell cannot be detected before, during, or after
  // approval. Approval does not fix an undetectable change; refuse
  // (results-002 codex).
  //
  // The gate is what this heal WOULD WRITE, not what the remote diff
  // reported (results-003 codex). Keying it on `remoteOps.length > 0` was
  // backwards: on a container page an empty remote diff is the WEAKEST
  // possible evidence of "nothing changed", since the edits this rule
  // exists for are exactly the ones that diff cannot see. A page with
  // `containerUncertain: true` and no reported remote ops sailed straight
  // through the refusal into a writable plan. A no-op heal is still
  // allowed: it writes nothing, so there is nothing to destroy.
  if (hasContainers(liveBlocks) && ops.length > 0) {
    throw new Error(
      "this page carries container blocks (tables, toggles) and this heal " +
        "would write to it — container children are invisible to the block " +
        "diff and to the staleness check, so neither can tell you what a " +
        "human touched. Heal this page by hand.",
    );
  }

  const { ids, humanAdded } = changedBlockIds(args.status.remoteOps);
  // A repeated block id with two DIFFERENT verdicts is a triage that has
  // not decided — and last-entry-wins would let a later "whitespace-only"
  // silently erase an earlier "substantive" and switch the approval gate
  // off (results-005 coderabbit). Refuse; agreeing duplicates are
  // harmless and pass through.
  const verdicts = new Map<string, Disposition>();
  for (const entry of args.classified) {
    const previous = verdicts.get(entry.blockId);
    if (previous !== undefined && previous !== entry.disposition) {
      throw new Error(
        `block ${entry.blockId} carries two different dispositions ` +
          `("${previous}" and "${entry.disposition}") — triage has to decide one`,
      );
    }
    verdicts.set(entry.blockId, entry.disposition);
  }
  const unclassified = ids.filter((id) => !verdicts.has(id));
  const needsApproval =
    humanAdded ||
    args.status.containerUncertain ||
    unclassified.length > 0 ||
    ids.some((id) => verdicts.get(id) === "substantive");

  // An empty op set overwrites nothing, so it needs no approval and must
  // not draft a comment: the page already reads exactly like the local
  // render, and "your edit is no longer shown" would be a false
  // statement posted where the human will read it. Approval gates a
  // WRITE; with no write there is nothing to gate.
  const overwritesHuman = needsApproval && ops.length > 0;
  return {
    ops,
    overwritesHuman,
    expectedTreeRev: treeRev(liveBlocks),
    ...(overwritesHuman
      ? {
          draftComment: draftHealComment({
            sourcePath: args.sourcePath,
            editedOn: args.editedOn,
            discardedText: args.discardedText,
          }),
        }
      : {}),
  };
}

/**
 * A human edited the drafted wording. Returning a NEW plan carrying their
 * text — rather than letting the caller pass arbitrary text to
 * `applyHeal` — is what keeps the approval check meaningful: the text
 * that posts is the text the plan carries, and changing it is an explicit
 * act rather than an argument nobody compares.
 */
export function withEditedComment(plan: HealPlan, edited: string): HealPlan {
  // Validate it can actually post before a human signs off on it.
  renderCommentRichText(edited);
  return { ...plan, draftComment: edited };
}

/**
 * Apply a plan. Two gates, in this order:
 *
 * 1. A plan that overwrites human content REFUSES unless the caller passes
 *    the EXACT approved text — the text the plan itself carries
 *    (results-002 coderabbit). Requiring merely "some string" let a caller
 *    approve the drafted comment, pass different text, and publish
 *    unreviewed words over a human's edit; an approval that does not name
 *    what was approved is not an approval. To change the wording, run the
 *    edit through `withEditedComment` and approve THAT plan.
 * 2. The live tree must still be the one the plan was computed against.
 *    Triage, approval and the write are separated by however long a human
 *    takes, the ops address blocks by id, and an op carrying pre-approval
 *    content would land on post-approval text. A mismatch sends the page
 *    back through triage; it is never resolved by re-diffing here, because
 *    the new diff would carry an approval nobody gave it.
 */
export async function applyHeal(
  client: HealClient,
  pageId: string,
  plan: HealPlan,
  approvedComment?: string,
): Promise<void> {
  // A comment passed for a plan that carries no draft is a confused
  // caller, and the confusion is dangerous in a sweep loop: the stale
  // draft from the PREVIOUS page posts here, unvalidated, describing a
  // heal of a different document. Refusing closes the last path by which
  // text nobody approved reaches a human-visible page — every other post
  // goes through the equality gate below (results-004 claude-code).
  if (!plan.overwritesHuman && approvedComment !== undefined) {
    throw new Error(
      `heal of ${pageId} carries no drafted explanation (it overwrites no ` +
        "human content), so there is nothing to approve — passing comment " +
        "text here would post words the plan never rehearsed",
    );
  }
  if (plan.overwritesHuman) {
    if (plan.draftComment === undefined) {
      throw new Error(
        `heal of ${pageId} would overwrite human-authored content but carries ` +
          "no drafted explanation — re-plan it",
      );
    }
    if (approvedComment !== plan.draftComment) {
      throw new Error(
        `heal of ${pageId} would overwrite human-authored content — pass the ` +
          "EXACT text a human approved (rehearse it with notion comment " +
          "--dry-run; to change the wording, use withEditedComment and " +
          "approve the new plan)",
      );
    }
  }
  // Re-read BEFORE anything is written, comment included: a stale plan
  // should not leave an explanation for a heal that never happens.
  const existing = await client.listBlocks(pageId);
  if (treeRev(existing) !== plan.expectedTreeRev) {
    throw new Error(
      `page ${pageId} changed after this heal was planned — re-run triage ` +
        "and, if it still overwrites human content, get the explanatory " +
        "comment approved against the new state",
    );
  }
  // …and refuse an unexecutable plan here too, not only at plan time: a
  // page that failed mid-write would carry a comment describing a heal
  // that did not happen.
  preflightOps(plan.ops, existing);

  // Re-check containers against the tree just read, not the one planned
  // against (results-003 codex). `treeRev` now covers `has_children`, so
  // this is belt-and-braces for the case it cannot cover: a page that
  // becomes container-bearing between plan and apply must refuse on the
  // same rule `planHeal` applies, and a refusal that lives only at plan
  // time is not a rule about writes.
  if (hasContainers(existing) && plan.ops.length > 0) {
    throw new Error(
      `page ${pageId} now carries container blocks and this heal would write ` +
        "to it — their children are invisible to the diff, so heal by hand",
    );
  }

  // Comment BEFORE the overwrite: a heal that fails halfway has still left
  // the explanation behind.
  if (approvedComment !== undefined) {
    await client.createComment({ pageId }, approvedComment);

    // …and re-check AFTER it (results-005 codex): the comment ride the
    // shared limiter, so the post is a real network interval — an edit
    // landing inside it was never triaged, and the pre-comment check
    // cannot speak for it. On a mismatch this refusal leaves the posted
    // comment standing over a heal that did not happen; the error says so
    // rather than pretending otherwise, because the alternative —
    // applying anyway — overwrites the very edit that just proved a human
    // is on the page RIGHT NOW. Notion has no conditional writes, so the
    // residual race is the single applyBlockOps request itself; that is
    // the irreducible floor, and it is documented in the mirror
    // reference.
    const recheck = await client.listBlocks(pageId);
    if (treeRev(recheck) !== plan.expectedTreeRev) {
      throw new Error(
        `page ${pageId} changed WHILE the explanatory comment was posting — ` +
          "the heal is refused and the just-posted comment may now be " +
          "stale. Someone is editing this page right now: re-run triage, " +
          "and reply in the comment thread if the explanation no longer " +
          "applies.",
      );
    }
  }
  if (plan.ops.length === 0) return;
  await client.applyBlockOps(pageId, existing, plan.ops);
}
