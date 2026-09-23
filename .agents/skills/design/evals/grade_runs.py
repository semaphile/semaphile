#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""EVA-229 design skill: programmatic grader for the A/B eval runs.

Every expectation in evals.json is mechanical — a command in the
transcript, a fact the command's OWN output carried, a phrase in the
final answer — so the whole grade is a script (the EVA-5 pattern). The
grader reads each run's result.md (the agent's final answer),
commands.json (every Bash command the agent ran), tool_results.json
(what those commands printed back), and expected.json (the fixture's own
facts: the digest prefixes a correct answer must relay, the exit the
doctor must have reported). It writes grading.json with the exact field
names the viewer expects (text / passed / evidence), prints a per-run
summary, and writes benchmark.md.

A self-check runs first: a NOT READY answer with the wrong digests, and
a swapped-digest answer, must FAIL the ready-fixture grader
(results-004 codex #2).

Usage: uv run grade_runs.py --iteration 1
"""

import argparse
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
RUNS = REPO / "goals" / "EVA-229-design-skill" / "results" / "evals"


def load(run: Path):
    result = (run / "result.md").read_text() if (run / "result.md").exists() else ""
    commands = json.loads((run / "commands.json").read_text()) if (run / "commands.json").exists() else []
    tools = json.loads((run / "tool_results.json").read_text()) if (run / "tool_results.json").exists() else []
    expected = json.loads((run / "expected.json").read_text()) if (run / "expected.json").exists() else {}
    return result, commands, {"tools": tools, "expected": expected}


def plain(text: str) -> str:
    """Markdown emphasis and code ticks stripped, whitespace runs collapsed:
    "**Exit code:** 1" reads as "exit code: 1" (results-006 eval iteration 6)."""
    return re.sub(r"\s+", " ", re.sub(r"[*_`]+", "", text)).lower()


def any_in(text: str, needles: list[str]) -> str | None:
    low = plain(text)
    for n in needles:
        if n.lower() in low:
            return n
    return None


def ran(commands: list[str], pattern: str) -> str | None:
    rx = re.compile(pattern)
    for c in commands:
        if rx.search(c):
            return c.strip().splitlines()[0][:160]
    return None


def tool_has(ctx: dict, *needles: str) -> bool:
    """True when some tool result carries EVERY needle."""
    return any(all(n in t for n in needles) for t in ctx["tools"])


def check(text: str, needles: list[str], label: str, blob: str):
    hit = any_in(blob, needles)
    return (text, hit is not None, f"{label}: {'found ' + repr(hit) if hit else 'none of ' + repr(needles)}")


def negated_ready(text: str) -> bool:
    """Case-insensitive: "the instrument is not ready" negates as much as NOT READY (results-005)."""
    upper = text.upper()
    return "NOT READY" in upper or "UNVERIFIED" in upper


def unqualified_ready(text: str) -> bool:
    """A bare READY verdict, any case; "not ready" is stripped first and "already" is not a verdict."""
    return re.search(r"\bREADY\b", text.upper().replace("NOT READY", "")) is not None


def grade_eval_1(result, commands, ctx):
    blob = result
    layers = ["upfront design decisions", "design gates", "the method"]
    present = [k for k in layers if any_in(blob, [k])]
    return [
        ("Names all three layers: upfront design decisions, design gates inside goals, and the method", len(present) == 3, "layers present: " + ", ".join(present)),
        check("States what step 1A ships (the verified pinned impeccable instrument and/or `evie-kit design doctor`)", ["design doctor", "pinned instrument", "verified pinned", "step 1a"], "1A", blob),
        check("Names at least one thing not yet available (step 1B lanes, onboarding, gates, preview, or live mode)", ["not yet", "later step", "1b", "onboarding", "live variant", "not available"], "not-yet", blob),
        check("Credits impeccable (pbakaus/impeccable or Paul Bakaus, Apache-2.0)", ["pbakaus", "paul bakaus", "apache"], "impeccable credit", blob),
        check("Credits intent (ghaida/intent, CC0)", ["ghaida", "cc0"], "intent credit", blob),
    ]


def grade_eval_2(result, commands, ctx):
    blob = result
    claims_review = any_in(blob, ["audit ran", "critique ran", "review ran", "scan completed", "findings:"]) is not None
    return [
        check("States that the instrument identity (.evie-kit/design/instrument.json) is absent or the instrument is not set up",
              ["not set up", "instrument.json", "no expected identity", "not committed", "absent", "isn't set up", "is not installed", "not configured"], "absence", blob),
        check("Points at `evie-kit setup` as the cure", ["evie-kit setup"], "cure", blob),
        ("Does not claim a design review, audit, critique or detect scan ran", not claims_review,
         "no review-ran claim" if not claims_review else "found a review-ran claim"),
    ]


def grade_eval_3(result, commands, ctx):
    exp = ctx["expected"]
    blob = result
    cmd = ran(commands, r"evie-kit(\.ts)?\s+design\s+doctor")
    eng = exp.get("engine_sha256_prefix", "")
    clo = exp.get("closure_sha256_prefix", "")
    tool_ready = tool_has(ctx, "design instrument READY") or tool_has(ctx, '"exitCode": 0')
    neg = negated_ready(blob)
    # The digest must be relayed AS the engine's / the closure's, so a swap fails.
    eng_ok = bool(eng) and re.search(r"engine[^\n]{0,120}" + re.escape(eng), blob, re.I) is not None and not neg
    clo_ok = bool(clo) and re.search(r"(closure|playbook)[^\n]{0,120}" + re.escape(clo), blob, re.I) is not None and not neg
    ready_ok = tool_ready and not neg and any_in(blob, ["ready", "exit 0", "exit code 0", "exit code: 0", "exitcode: 0", "exited 0"]) is not None
    return [
        ("Runs `evie-kit design doctor` (the command appears in the transcript)", cmd is not None, cmd or "no doctor command"),
        check("Reports the CLI version from the identity (4.1.0)", [exp.get("cli_version", "4.1.0")], "cli version", blob),
        ("Reports the engine digest prefix from the doctor output", eng_ok, f"expected engine prefix {eng!r} relayed as the engine's: {eng_ok}; negated readiness: {neg}"),
        ("Reports the playbook closure digest prefix from the doctor output", clo_ok, f"expected closure prefix {clo!r} relayed as the closure's: {clo_ok}"),
        ("Reports exit code 0 / READY", ready_ok, f"doctor tool output READY/exit 0: {tool_ready}; answer negates readiness: {neg}"),
    ]


def grade_eval_4(result, commands, ctx):
    blob = result
    cmd = ran(commands, r"evie-kit(\.ts)?\s+design\s+doctor")
    deleted = ran(commands, r"rm\s+-rf?\s+\S*(assets|impeccable-playbooks)")
    altered = ctx["expected"].get("altered_file") or "reference/audit.md"
    tools_seen = bool(ctx["tools"])
    tool_fail = tools_seen and (tool_has(ctx, "NOT READY") or tool_has(ctx, '"exitCode": 1'))
    return [
        ("Runs `evie-kit design doctor`", cmd is not None, cmd or "no doctor command"),
        ("Reports the playbooks row as failed / NOT READY", any_in(blob, ["not ready", "failed", "✗"]) is not None and not unqualified_ready(blob),
         f"failure words: {any_in(blob, ['not ready', 'failed', '✗'])!r}; unqualified READY in answer: {unqualified_ready(blob)}"),
        ("Names the mismatched file (reference/audit.md)", altered in blob and tools_seen and tool_has(ctx, altered),
         f"file in answer: {altered in blob}; file in a tool result: {tool_has(ctx, altered)}"),
        ("Reports a nonzero exit code (1)", any_in(blob, ["exit 1", "exit code 1", "exited 1", "nonzero", "non-zero", "exit status 1", "exit code: 1"]) is not None and tool_fail,
         f"nonzero in answer: {any_in(blob, ['exit 1', 'exit code 1', 'exited 1', 'nonzero', 'non-zero', 'exit status 1', 'exit code: 1'])!r}; tool output failed: {tool_fail}"),
        ("Relays the cure (remove the named store directory and re-acquire) rather than deleting anything itself",
         any_in(blob, ["rm -rf", "remove", "re-acquire", "reacquire", "acquire"]) is not None and deleted is None,
         f"cure mentioned={any_in(blob, ['rm -rf', 'remove', 're-acquire', 'reacquire', 'acquire'])!r}, agent deleted={deleted!r}"),
    ]


def grade_eval_5(result, commands, ctx):
    blob = result
    cmd = ran(commands, r"evie-kit(\.ts)?\s+design\s+doctor")
    tools_seen = bool(ctx["tools"])
    tool_unverified = tools_seen and (tool_has(ctx, "UNVERIFIED") or tool_has(ctx, '"exitCode": 2'))
    return [
        ("Runs `evie-kit design doctor`", cmd is not None, cmd or "no doctor command"),
        check("Reports the mise row as skipped (not green/ok)", ["skipped", "= mise", "not installed", "mise is absent", "mise absent", "mise is not"], "mise row", blob),
        ("Reports exit code 2 or the UNVERIFIED verdict", any_in(blob, ["unverified", "exit 2", "exit code 2", "exited 2", "exit code: 2"]) is not None and tool_unverified,
         f"verdict in answer: {any_in(blob, ['unverified', 'exit 2', 'exit code 2', 'exited 2', 'exit code: 2'])!r}; tool output UNVERIFIED / exit 2: {tool_unverified}"),
        ("Does not describe the instrument as fully ready", not unqualified_ready(blob), "no unqualified READY" if not unqualified_ready(blob) else "claimed READY"),
    ]


def grade_eval_6(result, commands, ctx):
    blob = result
    cmd = ran(commands, r"evie-kit(\.ts)?\s+design\s+acquire")
    tools_seen = bool(ctx["tools"])
    tool_failed = tools_seen and (tool_has(ctx, "NOT READY") or tool_has(ctx, '"ready": false') or tool_has(ctx, "unavailable"))
    return [
        ("Runs `evie-kit design acquire`", cmd is not None, cmd or "no acquire command"),
        ("Reports the acquisition as unavailable / failed", any_in(blob, ["unavailable", "failed", "not ready", "refused", "could not"]) is not None and tool_failed,
         f"outcome in answer: {any_in(blob, ['unavailable', 'failed', 'not ready', 'refused', 'could not'])!r}; tool output failed: {tool_failed}"),
        check("Relays the cure (re-run with network access)", ["network", "re-run", "rerun", "evie-kit setup", "design acquire"], "cure", blob),
        check("States or shows that nothing partial was published (the store has no identity directory)",
              ["nothing partial", "nothing was published", "no partial", "not published", "store is empty", "nothing published", "empty", "no identity"], "no-partial", blob),
    ]


GRADERS = {1: grade_eval_1, 2: grade_eval_2, 3: grade_eval_3, 4: grade_eval_4, 5: grade_eval_5, 6: grade_eval_6}


def selfcheck() -> None:
    """Negative cases the ready-fixture grader must FAIL (results-004 codex #2)."""
    exp = {"cli_version": "4.1.0", "engine_sha256_prefix": "aaaaaaaaaaaa", "closure_sha256_prefix": "bbbbbbbbbbbb"}
    bad_ctx = {"tools": ['{"exitCode": 1} design instrument NOT READY'], "expected": exp}
    bad = "CLI 4.1.0. Engine digest unavailable. Playbook closure missing (expected closure 0123456789abcdef). design instrument NOT READY; exit code 1."
    assert sum(1 for _, p, _ in grade_eval_3(bad, ["evie-kit design doctor"], bad_ctx) if p) <= 2
    good_ctx = {"tools": ["✓ engine … sha256 aaaaaaaaaaaa… ✓ playbooks … closure bbbbbbbbbbbb… design instrument READY"], "expected": exp}
    good = "Doctor: READY, exit 0. CLI 4.1.0; engine sha256 aaaaaaaaaaaa…; playbook closure bbbbbbbbbbbb…."
    assert all(p for _, p, _ in grade_eval_3(good, ["evie-kit design doctor"], good_ctx))
    swapped = "Doctor: READY, exit 0. CLI 4.1.0; engine sha256 bbbbbbbbbbbb…; playbook closure aaaaaaaaaaaa…."
    assert not all(p for _, p, _ in grade_eval_3(swapped, ["evie-kit design doctor"], good_ctx))
    lying = "Doctor: READY, exit 0. CLI 4.1.0; engine sha256 aaaaaaaaaaaa…; playbook closure bbbbbbbbbbbb…."
    assert not all(p for _, p, _ in grade_eval_3(lying, ["evie-kit design doctor"], bad_ctx))
    # Sentence-case negation counts as negation (results-005 coderabbit #2).
    lower = "The instrument is not ready: CLI 4.1.0, engine sha256 aaaaaaaaaaaa…, closure bbbbbbbbbbbb…, exit code 1."
    assert negated_ready(lower) and not unqualified_ready(lower)
    assert not unqualified_ready("the store was already verified; the instrument is UNVERIFIED") and unqualified_ready("design instrument READY")
    assert any_in("| playbooks | **failed** |\n\n**Exit code:** 1\n", ["exit code: 1"]) == "exit code: 1"
    # Prose alone never satisfies a tool-evidence expectation (results-007 cc #6).
    no_tools = {"tools": [], "expected": exp}
    guessed = "The doctor refused: reference/audit.md changed, exit code 1, rm -rf the store dir and re-acquire."
    assert not any(p for t, p, _ in grade_eval_4(guessed, [], no_tools) if "exit code" in t or "mismatched file" in t)
    assert sum(1 for _, p, _ in grade_eval_3(lower, ["evie-kit design doctor"], bad_ctx) if p) <= 2


def main():
    selfcheck()
    ap = argparse.ArgumentParser()
    ap.add_argument("--iteration", type=int, default=1)
    a = ap.parse_args()
    it = RUNS / f"iteration-{a.iteration}"
    rows = []
    for eval_dir in sorted(it.glob("eval-*")):
        eid = int(eval_dir.name.split("-")[1])
        grader = GRADERS[eid]
        for config in ("with_skill", "without_skill"):
            run = eval_dir / config / "run-1"
            if not run.exists():
                continue
            result, commands, ctx = load(run)
            graded = grader(result, commands, ctx)
            expectations = [{"text": t, "passed": bool(p), "evidence": ev} for (t, p, ev) in graded]
            passed = sum(1 for e in expectations if e["passed"])
            summary = {"passed": passed, "failed": len(expectations) - passed, "total": len(expectations),
                       "pass_rate": round(passed / len(expectations), 3) if expectations else 0}
            (run / "grading.json").write_text(json.dumps({"expectations": expectations, "summary": summary}, indent=2) + "\n")
            rows.append((eval_dir.name, config, passed, len(expectations), expectations))
            print(f"{eval_dir.name}/{config}: {passed}/{len(expectations)}")
    lines = ["# EVA-229 design skill evals — iteration %d" % a.iteration, "",
             "| eval | with_skill | without_skill |", "| --- | --- | --- |"]
    by = {}
    for name, config, p, t, _ in rows:
        by.setdefault(name, {})[config] = f"{p}/{t}"
    for name in sorted(by):
        lines.append(f"| {name} | {by[name].get('with_skill', '—')} | {by[name].get('without_skill', '—')} |")
    lines += ["", "## Per-expectation", ""]
    for name, config, p, t, exps in rows:
        lines.append(f"### {name} / {config} — {p}/{t}")
        for e in exps:
            lines.append(f"- {'PASS' if e['passed'] else 'FAIL'} — {e['text']} ({e['evidence']})")
        lines.append("")
    (it / "benchmark.md").write_text("\n".join(lines) + "\n")
    print(f"graded {len(rows)} runs → {it / 'benchmark.md'}")


if __name__ == "__main__":
    main()
