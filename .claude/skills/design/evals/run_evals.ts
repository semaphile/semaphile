#!/usr/bin/env bun
/**
 * A/B eval runner for the design skill (EVA-229 gate 10), the EVA-5
 * pattern: each arm is a headless `claude -p` session in an isolated
 * fixture workspace under the OS temp dir (never inside a repo — Claude
 * Code discovers `.claude/skills` from ancestors, which would un-blind
 * the baseline arm). Fixtures are built from a FAKE instrument identity
 * whose digests describe tiny fake bytes, a per-fixture verified store
 * (`EVIE_KIT_ASSETS_ROOT`), and PATH shims so `evie-kit` resolves to THIS
 * checkout and `mise` can be made absent. The stream-json transcript is
 * kept so the grader can see which commands the agent ran.
 *
 *   bun skills/design/evals/run_evals.ts --iteration 1 [--only-eval 3] [--only-config with_skill] [--model claude-sonnet-5]
 *
 * Run directories (aggregate_benchmark layout):
 *   goals/EVA-229-design-skill/results/evals/iteration-<N>/eval-<id>-<name>/<config>/run-1/
 *     workspace_path.txt, result.json, events.jsonl, result.md, timing.json
 */

import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  ASSET_RECORD,
  closureDigest,
  currentPlatform,
  engineSpec,
  identityDir,
  INSTRUMENT_RELATIVE_PATH,
  parseInstrument,
  playbooksSpec,
  readShippedInstrument,
  sha256Hex,
  type Instrument,
} from "@evie-kit/design";

const HERE = resolve(import.meta.dir);
const REPO = resolve(HERE, "..", "..", "..");
const RUNS = join(REPO, "goals", "EVA-229-design-skill", "results", "evals");
const SKILL_SRC = join(REPO, "skills", "design");
const EVALS = JSON.parse(await Bun.file(join(HERE, "evals.json")).text()) as {
  evals: { id: number; name: string; prompt: string; fixture: string; expectations: string[] }[];
};
const args = process.argv.slice(2);
const argOf = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const iteration = Number(argOf("iteration", "1"));
const onlyEval = argOf("only-eval");
const onlyConfig = argOf("only-config");
const model = argOf("model", "claude-sonnet-5")!;
const timeoutMin = Number(argOf("timeout-min", "15"));
const configs = (onlyConfig ? [onlyConfig] : ["with_skill", "without_skill"]) as ("with_skill" | "without_skill")[];

const WITH_SKILL_PREAMBLE =
  "Execute this task:\n" +
  "- Skill path: .claude/skills/design — read its SKILL.md first and follow it, including the reference it tells you to read.\n" +
  "- The project's evie-kit toolchain is on PATH as `evie-kit` (also `bun node_modules/@evie-kit/cli/src/evie-kit.ts`).\n" +
  "- Task:\n\n";
const WITHOUT_SKILL_PREAMBLE =
  "Execute this task:\n" +
  "- The project's evie-kit toolchain is on PATH as `evie-kit` (also `bun node_modules/@evie-kit/cli/src/evie-kit.ts`).\n" +
  "- Task:\n\n";

// ---------------------------------------------------------------- fixtures

const ENGINE_BYTES = "#!/bin/sh\n[ \"$1\" = engine-probe ] && { echo 'impeccable-engine 0.1.5'; exit 0; }\necho '[]'; exit 0\n";
const CLOSURE: Record<string, string> = {
  "SKILL.md": "---\nname: impeccable\nversion: 4.3.0\n---\nfixture playbook\n",
  "reference/audit.md": "# audit\nfixture\n",
  "reference/critique.md": "# critique\nfixture\n",
  "scripts/VERSION": "0.1.5\n",
  "scripts/command-metadata.json": "{}\n",
  "scripts/data/font-index.json": "[]\n",
};

/** The fixture's own CLI launcher: what the fixture mise "materializes",
 * so the doctor's cli row is judged against the fixture, never the
 * host's real install (results-007, claude-code #3). */
const LAUNCHER = "#!/bin/sh\necho 4.1.0\n";

function fakeInstrument(opts: { unreachable?: boolean } = {}): Instrument {
  const base = JSON.parse(JSON.stringify(readShippedInstrument()));
  const platform = currentPlatform()!;
  base.cli.launcher.sha256 = sha256Hex(LAUNCHER);
  base.engine.platforms[platform].sha256 = sha256Hex(ENGINE_BYTES);
  base.engine.platforms[platform].size = ENGINE_BYTES.length;
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(CLOSURE)) files[k] = sha256Hex(v);
  base.playbooks.files = files;
  base.playbooks.closure_sha256 = closureDigest(files);
  if (opts.unreachable) {
    base.engine.release_base = "http://127.0.0.1:9/releases";
    base.playbooks.bundle.url = "http://127.0.0.1:9/releases/universal.zip";
  }
  return parseInstrument(JSON.stringify(base));
}

function warmStore(store: string, instrument: Instrument, alter?: string): void {
  const platform = currentPlatform()!;
  const eng = engineSpec(instrument, platform)!;
  const engDir = identityDir(store, eng);
  mkdirSync(engDir, { recursive: true });
  writeFileSync(join(engDir, eng.entry), ENGINE_BYTES, { mode: 0o755 });
  writeFileSync(join(engDir, ASSET_RECORD), JSON.stringify({ schema: 1, kind: "file", fixture: true }));
  const pb = playbooksSpec(instrument);
  const pbDir = identityDir(store, pb);
  for (const [k, v] of Object.entries(CLOSURE)) {
    mkdirSync(dirname(join(pbDir, k)), { recursive: true });
    writeFileSync(join(pbDir, k), alter === k ? `${v}TAMPERED\n` : v);
  }
  writeFileSync(join(pbDir, ASSET_RECORD), JSON.stringify({ schema: 1, kind: "tree", fixture: true }));
}

function sh(argv: string[], cwd: string): void {
  const r = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`${argv.join(" ")} failed: ${r.stderr.toString()}`);
}

interface Fixture {
  ws: string;
  env: Record<string, string>;
  /** What a correct answer must relay, from the fixture's own identity. */
  expected: Record<string, unknown>;
}

function buildFixture(kind: string, config: "with_skill" | "without_skill"): Fixture {
  const ws = mkdtempSync(join(tmpdir(), `eva229-design-eval-${kind}-${config}-`));
  const store = join(ws, ".store");
  const bin = join(ws, ".bin");
  mkdirSync(store);
  mkdirSync(bin);
  sh(["git", "init", "-q", "-b", "main"], ws);
  sh(["git", "config", "user.email", "fixture@example.com"], ws);
  sh(["git", "config", "user.name", "Fixture Author"], ws);
  writeFileSync(join(ws, "README.md"), "# fixture project\n\nA consumer project using evie-kit.\n");
  mkdirSync(join(ws, ".evie-kit"), { recursive: true });
  writeFileSync(join(ws, ".evie-kit", "settings.ts"), "export default {};\n");
  writeFileSync(join(ws, ".mise.toml"), `[tools]\nbun = "1.4.2"\n"npm:impeccable" = "4.1.0"\n`);
  // evie-kit resolves to THIS checkout, by shim and by the documented path.
  mkdirSync(join(ws, "node_modules", "@evie-kit"), { recursive: true });
  symlinkSync(join(REPO, "packages", "cli"), join(ws, "node_modules", "@evie-kit", "cli"));
  writeFileSync(join(bin, "evie-kit"), `#!/bin/sh\nexec bun ${join(REPO, "packages", "cli", "src", "evie-kit.ts")} "$@"\n`);
  chmodSync(join(bin, "evie-kit"), 0o755);
  const unreachable = kind === "project-cold-offline";
  const instrument = fakeInstrument({ unreachable });
  if (kind !== "project-no-identity") {
    mkdirSync(dirname(join(ws, INSTRUMENT_RELATIVE_PATH)), { recursive: true });
    writeFileSync(join(ws, INSTRUMENT_RELATIVE_PATH), `${JSON.stringify(instrument, null, 2)}\n`);
  }
  if (kind === "project-ready" || kind === "project-mise-absent") warmStore(store, instrument);
  if (kind === "project-altered-playbook") warmStore(store, instrument, "reference/audit.md");
  if (kind === "project-mise-absent") {
    writeFileSync(join(bin, "mise"), "#!/bin/sh\necho 'mise: command not found' >&2\nexit 127\n");
    chmodSync(join(bin, "mise"), 0o755);
  } else {
    // The fixture owns mise too: a shim that answers --version and
    // `where npm:impeccable@4.1.0` with a fixture install dir carrying the
    // fixture launcher (bin entry symlinked to it, as npm lays it out).
    const install = join(ws, ".mise-install");
    const launcherDir = join(install, "lib", "node_modules", instrument.cli.package, "cli", "bin");
    mkdirSync(launcherDir, { recursive: true });
    mkdirSync(join(install, "bin"), { recursive: true });
    writeFileSync(join(launcherDir, "cli.js"), LAUNCHER, { mode: 0o755 });
    symlinkSync(join(launcherDir, "cli.js"), join(install, "bin", instrument.cli.package));
    writeFileSync(
      join(bin, "mise"),
      "#!/bin/sh\n" +
        'case "$1" in\n' +
        "  --version) echo '2026.1.6 fixture'; exit 0;;\n" +
        `  where) [ "$2" = "npm:${instrument.cli.package}@${instrument.cli.version}" ] && { echo '${install}'; exit 0; }; echo 'not installed' >&2; exit 1;;\n` +
        "  ls) echo '{}'; exit 0;;\n" +
        "esac\necho \"mise fixture: unexpected $*\" >&2; exit 1\n",
    );
    chmodSync(join(bin, "mise"), 0o755);
  }
  if (config === "with_skill") {
    mkdirSync(join(ws, ".claude", "skills"), { recursive: true });
    cpSync(SKILL_SRC, join(ws, ".claude", "skills", "design"), { recursive: true });
    rmSync(join(ws, ".claude", "skills", "design", "evals"), { recursive: true, force: true });
  }
  sh(["git", "add", "-A"], ws);
  sh(["git", "commit", "-q", "-m", "fixture"], ws);
  // A MINIMAL environment for a bypass-permissions session: only what the
  // shell, the toolchain and Claude Code's own auth need. Nothing else of
  // the host's env (repo tokens, cloud keys, agent sockets) reaches the
  // session (results-007, coderabbit). HOME stays real for Claude Code's
  // config; mise is the fixture's shim, so the host's installs are never
  // consulted.
  const KEEP = /^(PATH|HOME|TMPDIR|TERM|LANG|LC_[A-Z_]+|SHELL|USER|LOGNAME|XDG_[A-Z_]+|ANTHROPIC_[A-Z_]+|CLAUDE_CONFIG_DIR|HTTPS?_PROXY|NO_PROXY|https?_proxy|no_proxy)$/;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && KEEP.test(k)) env[k] = v;
  }
  const platform = currentPlatform()!;
  const expected = {
    cli_version: instrument.cli.version,
    engine_sha256_prefix: instrument.engine.platforms[platform]!.sha256.slice(0, 12),
    closure_sha256_prefix: instrument.playbooks.closure_sha256.slice(0, 12),
    identity_present: kind !== "project-no-identity",
    store_warm: kind === "project-ready" || kind === "project-mise-absent" || kind === "project-altered-playbook",
    altered_file: kind === "project-altered-playbook" ? "reference/audit.md" : null,
    mise_absent: kind === "project-mise-absent",
    doctor_exit: kind === "project-ready" ? 0 : kind === "project-mise-absent" ? 2 : 1,
  };
  env["PATH"] = `${bin}:${env["PATH"] ?? ""}`;
  // The store is per fixture; HOME stays real so Claude Code's own config
  // resolves (the fixture's mise shim keeps the host's installs out).
  env["EVIE_KIT_ASSETS_ROOT"] = store;
  return { ws, env, expected };
}

// ---------------------------------------------------------------- runs

async function runOne(e: (typeof EVALS.evals)[number], config: "with_skill" | "without_skill"): Promise<void> {
  const runDir = join(RUNS, `iteration-${iteration}`, `eval-${e.id}-${e.name}`, config, "run-1");
  mkdirSync(runDir, { recursive: true });
  const fx = buildFixture(e.fixture, config);
  writeFileSync(join(runDir, "workspace_path.txt"), `${fx.ws}\n`);
  writeFileSync(join(runDir, "expected.json"), `${JSON.stringify(fx.expected, null, 2)}\n`);
  const prompt = `${config === "with_skill" ? WITH_SKILL_PREAMBLE : WITHOUT_SKILL_PREAMBLE}${e.prompt}`;
  writeFileSync(join(runDir, "prompt.md"), `${prompt}\n`);
  const started = Date.now();
  const proc = Bun.spawn(
    ["claude", "-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", "--model", model],
    { cwd: fx.ws, env: fx.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => proc.kill(), timeoutMin * 60_000);
  const [stdout, stderr, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  clearTimeout(timer);
  const durationMs = Date.now() - started;
  writeFileSync(join(runDir, "events.jsonl"), stdout);
  writeFileSync(join(runDir, "stderr.txt"), stderr);
  let resultText = "";
  let usage: unknown = null;
  const commands: string[] = [];
  // Every Bash tool RESULT the agent saw, in order: the grader judges the
  // commands' actual output, not only the agent's prose.
  const toolResults: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === "result") {
        resultText = ev.result ?? "";
        usage = ev.usage ?? null;
      }
      if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
        for (const c of ev.message.content) {
          if (c.type === "tool_use" && c.name === "Bash" && typeof c.input?.command === "string") commands.push(c.input.command);
        }
      }
      if (ev.type === "user" && Array.isArray(ev.message?.content)) {
        for (const c of ev.message.content) {
          if (c.type !== "tool_result") continue;
          const body = Array.isArray(c.content) ? c.content.map((x: { text?: string }) => x.text ?? "").join("\n") : String(c.content ?? "");
          toolResults.push(body);
        }
      }
    } catch {
      // non-JSON noise
    }
  }
  writeFileSync(join(runDir, "result.md"), `${resultText}\n`);
  writeFileSync(join(runDir, "commands.json"), `${JSON.stringify(commands, null, 2)}\n`);
  writeFileSync(join(runDir, "tool_results.json"), `${JSON.stringify(toolResults, null, 2)}\n`);
  writeFileSync(join(runDir, "result.json"), JSON.stringify({ exit, model, config, eval: e.name, fixture: e.fixture, usage }, null, 2));
  writeFileSync(join(runDir, "timing.json"), JSON.stringify({ duration_ms: durationMs, exit_code: exit, model, recorded_at: new Date().toISOString() }, null, 2));
  console.log(`eval-${e.id}-${e.name}/${config}: exit ${exit}, ${Math.round(durationMs / 1000)}s, ${commands.length} commands`);
}

const selected = EVALS.evals.filter((e) => onlyEval === undefined || String(e.id) === onlyEval);
for (const e of selected) {
  mkdirSync(join(RUNS, `iteration-${iteration}`, `eval-${e.id}-${e.name}`), { recursive: true });
  writeFileSync(
    join(RUNS, `iteration-${iteration}`, `eval-${e.id}-${e.name}`, "eval_metadata.json"),
    `${JSON.stringify({ eval_id: e.id, eval_name: e.name, prompt: e.prompt, fixture: e.fixture, assertions: e.expectations }, null, 2)}\n`,
  );
}
const work: (() => Promise<void>)[] = [];
for (const e of selected) for (const c of configs) work.push(() => runOne(e, c));
// Four at a time — enough parallelism, and the machine stays quiet.
const parallel = Number(argOf("parallel", "4"));
const runners = Array.from({ length: Math.min(parallel, work.length) }, async () => {
  for (;;) {
    const next = work.shift();
    if (next === undefined) return;
    await next();
  }
});
await Promise.all(runners);
if (!existsSync(RUNS)) mkdirSync(RUNS, { recursive: true });
console.log("done");
