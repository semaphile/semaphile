/**
 * Second-stage mirror status, wired from primitives that exist today
 * (EVA-106). Answers the question a page timestamp cannot: did the CONTENT
 * change, or did metadata merely bump?
 *
 * These files are typechecked (`tsconfig.json` beside them, wired into
 * `@evie-kit/notion`'s `typecheck` script) and exercised by
 * `packages/notion/src/skillExamples.test.ts`, so the skill never
 * documents a call that does not compile or a shape that does not hold.
 */

import { diffBlocks, type DiffOp, type NotionClient } from "@evie-kit/notion";
import type { BlockChild } from "@evie-kit/notion/basic-memory";

/** The reads this needs — inject a subset so callers can test with a fake. */
export type StatusClient = Pick<NotionClient, "getPage" | "listBlocks" | "getComments">;

export interface MirrorStatus {
  pageId: string;
  /** Stage one: the page's own timestamp moved past the last sync. */
  candidate: boolean;
  /** Stage two: the live block tree really differs from the synced base. */
  contentChanged: boolean;
  /** What changed remotely. Empty when this was a metadata bump. */
  remoteOps: DiffOp[];
  /**
   * The page carries container blocks (tables, toggles), which compare
   * ATOMICALLY — so on such a page `contentChanged` is not decidable in
   * EITHER direction (results-001 coderabbit), and the two available
   * signals fail opposite ways:
   *
   * - the top-level `diffBlocks` here OVER-reports: a container cannot be
   *   updated in place, so an untouched table still emits delete+append
   *   ops and `contentChanged` reads true;
   * - the CLI's rev comparison (`remoteChangedSinceSync`) UNDER-reports:
   *   container children never move the revs, so an edit inside a cell
   *   reads clean.
   *
   * Neither verdict is evidence on such a page. Triage by hand; never
   * close the incident and never heal unattended while this is set.
   */
  containerUncertain: boolean;
  /**
   * The exact tree `remoteOps` was computed against — THE snapshot, not a
   * copy of one (results-004 codex).
   *
   * It is here because the alternative was letting the caller supply the
   * live tree and the ops separately, and nothing checked that they came
   * from the same read. A teammate editing a block between those two
   * reads produced a plan whose approval decision was derived from the
   * OLD ops while its staleness stamp came from the NEW tree — so the
   * later re-check passed and an untriaged human edit was overwritten
   * with no approval and no comment. Two arguments that must agree are a
   * defect; one value that cannot disagree with itself is the fix.
   *
   * Empty when stage one did not fire: no read was made, so there is no
   * snapshot to carry, and `planHeal` refuses rather than guessing.
   */
  liveBlocks: BlockChild[];
}

/** Notion's read-back marks a container with `has_children`. */
function hasContainers(blocks: BlockChild[]): boolean {
  return blocks.some((block) => (block as { has_children?: boolean }).has_children === true);
}

/**
 * Notion rounds edit timestamps DOWN to the minute, and the sync stamp is
 * written from a full-precision local clock. A sync at 10:00:30 followed
 * by a human edit at 10:00:45 therefore reports `updatedAt = 10:00:00`,
 * which is BEFORE the stamp — so a naive `updatedAt > syncedAt` skips
 * stage two entirely and calls a real edit nothing (results-001 codex).
 * Widening the comparison by the granularity costs one extra block read
 * per page per sync minute and closes the hole.
 */
const TIMESTAMP_GRANULARITY_MS = 60_000;

/**
 * Stage one is a candidate, never a verdict: `last_edited_time` bumps for
 * property edits, comment activity and Notion-side churn. Stage two is the
 * verdict, and it only runs when stage one fired — so the common case costs
 * one page read.
 *
 * Stage one is also allowed to be WRONG in only one direction. It may say
 * "look closer" when nothing happened; it must never say "nothing
 * happened" when something did, which is why the comparison carries the
 * granularity window above.
 */
export async function verifyMirrorStatus(
  client: StatusClient,
  args: { pageId: string; syncedAt: Date; baseBlocks: BlockChild[] },
): Promise<MirrorStatus> {
  const page = await client.getPage(args.pageId);
  // NaN poisons every comparison to false, and false here means "nothing
  // happened" — the one direction stage one must never be wrong in
  // (results-005 codex). A malformed sync stamp or page timestamp is
  // ordinary input for a distributed example (a partially-migrated
  // frontmatter, a hand-edited stamp), and failing OPEN on it would skip
  // the block read AND the comment sweep on a page nobody examined. So
  // invalid timestamps refuse loudly instead of comparing.
  const pageMs = new Date(page.updatedAt).getTime();
  const syncMs = args.syncedAt.getTime();
  if (!Number.isFinite(pageMs) || !Number.isFinite(syncMs)) {
    throw new Error(
      `cannot classify page ${args.pageId}: ` +
        (Number.isFinite(pageMs)
          ? `the sync stamp is not a valid date`
          : `the page's updatedAt (${JSON.stringify(page.updatedAt)}) is not a valid date`) +
        " — a NaN comparison would silently read as \"nothing happened\", " +
        "which is the one direction status must never be wrong in. Fix " +
        "the stamp (or re-sync) and re-run.",
    );
  }
  const candidate = pageMs > syncMs - TIMESTAMP_GRANULARITY_MS;
  if (!candidate) {
    return {
      pageId: args.pageId,
      candidate: false,
      contentChanged: false,
      remoteOps: [],
      containerUncertain: hasContainers(args.baseBlocks),
      liveBlocks: [],
    };
  }
  // Always a live read: a cached render will happily serve the pre-bump
  // body and tell you nothing changed.
  const remote = await client.listBlocks(args.pageId);
  const remoteOps = diffBlocks(args.baseBlocks, remote);
  return {
    pageId: args.pageId,
    candidate: true,
    contentChanged: remoteOps.length > 0,
    remoteOps,
    containerUncertain: hasContainers(args.baseBlocks) || hasContainers(remote),
    liveBlocks: remote,
  };
}

export interface TriageResult extends MirrorStatus {
  /**
   * What the humans said on the page, in their own words. Read, never
   * merged. `blockId` is present when the comment was anchored to a
   * specific block rather than to the page — which is most of them, and
   * the reason triage reads DEEP.
   */
  commentary: Array<{ discussionId: string; text: string; blockId?: string }>;
  /**
   * False when the deep sweep hit its bounds or lost a block: the
   * commentary is a partial answer and "no objections" cannot be
   * concluded from it. A short-circuited clean page reports `true` —
   * there was nothing to sweep.
   */
  sweepComplete: boolean;
}

/**
 * Triage adds the half that hand-rolled scripts skip: a human who edited a
 * mirrored page usually explained why, in a comment, on that page. The
 * comment text stays out of the document — it informs the disposition and
 * gives you a thread to reply into.
 */
export async function triageMirrorPage(
  client: StatusClient,
  args: { pageId: string; syncedAt: Date; baseBlocks: BlockChild[] },
): Promise<TriageResult> {
  const status = await verifyMirrorStatus(client, args);
  // Sweep every CANDIDATE, not only pages whose blocks moved
  // (results-004 codex). The old gate skipped the sweep whenever the body
  // was unchanged — which threw away the entire comment-only case, and
  // did so while the heal comment this same flow generates tells humans
  // "comment here and it will be picked up in triage". A reply is human
  // input whether or not the body changed; a page whose only news is a
  // new objection was being closed as a metadata bump, unread.
  //
  // Stage one still gates it, so an untouched page costs one page read
  // and nothing else. What used to be the skip condition is now merely
  // the reason a candidate exists.
  if (!status.candidate) {
    return { ...status, commentary: [], sweepComplete: true };
  }
  // DEEP, not the page-level read (EVA-104). The shallow endpoint answers
  // only for comments anchored to the page itself, and the natural way to
  // leave feedback is on the PARAGRAPH you disagree with — so a page
  // covered in margin notes reports zero comments here, and triage
  // concludes "nobody objected" about a page full of objections. That is
  // the wrong direction for a check whose whole job is to notice humans.
  const deep = await client.getComments({ pageId: args.pageId }, { deep: true });
  return {
    ...status,
    // A truncated or partially-failed sweep is REPORTED, never silently
    // treated as the whole story: "no comments found" and "we stopped
    // looking" have to be distinguishable to a caller deciding whether it
    // is safe to overwrite someone.
    sweepComplete: !deep.truncated && deep.failed.length === 0,
    commentary: deep.comments.map((comment) => ({
      discussionId: comment.discussionId,
      text: comment.plainText,
      ...(comment.parentBlockId ? { blockId: comment.parentBlockId } : {}),
    })),
  };
}
