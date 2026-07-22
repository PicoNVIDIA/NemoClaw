// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Draft a per-skill policy block from a skill directory.
 *
 * Reads the skill's SKILL.md frontmatter and scans the skill's files for
 * hostnames, then emits a least-privilege preset YAML in the
 * nemoclaw-blueprint/policies/presets/skills/ format:
 *
 *   tsx scripts/skill-policy-block.mts <skill-dir-or-SKILL.md> [--write] [--force]
 *
 * By default the draft prints to stdout with apply instructions. --write
 * saves it as policy.yaml next to SKILL.md so it ships with the skill
 * (`skill install` uploads all non-dot files).
 *
 * The output is a reviewed-by-a-human starting point, not a finished policy:
 * every endpoint starts GET-only and hosts are inferred, not proven.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";

const MAX_SCAN_BYTES = 256 * 1024;
const SCAN_EXTENSIONS = new Set([
  ".md",
  ".py",
  ".sh",
  ".ts",
  ".mts",
  ".js",
  ".mjs",
  ".json",
  ".yaml",
  ".yml",
  ".txt",
  ".toml",
]);
const IGNORED_HOSTS = [
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/,
  /(^|\.)example\.(com|org|net)$/,
  /^json-schema\.org$/,
  /^spdx\.org$/,
  /^schemas\./,
  /^img\.shields\.io$/,
  // Covered by the baseline sandbox policy or existing integration presets.
  /(^|\.)npmjs\.org$/,
  /(^|\.)pypi\.org$/,
  /(^|\.)pythonhosted\.org$/,
];

interface SkillFrontmatter {
  name?: string;
  description?: string;
  metadata?: {
    openclaw?: SkillRequiresBlock;
    clawdbot?: SkillRequiresBlock;
    clawdis?: SkillRequiresBlock;
  };
}

interface SkillRequiresBlock {
  requires?: { env?: string[]; bins?: string[] };
}

function fail(message: string): never {
  console.error(`  ${message}`);
  process.exit(1);
}

function resolveSkillDir(input: string): string {
  const resolved = path.resolve(input);
  if (!existsSync(resolved)) fail(`Path not found: ${resolved}`);
  const dir = statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  if (!existsSync(path.join(dir, "SKILL.md"))) fail(`No SKILL.md in ${dir}`);
  return dir;
}

export function parseFrontmatter(skillMdText: string): SkillFrontmatter {
  const match = skillMdText.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  try {
    const parsed = YAML.parse(match[1]);
    return parsed && typeof parsed === "object" ? (parsed as SkillFrontmatter) : {};
  } catch {
    return {};
  }
}

/** Collect https?:// hostnames (with any observed paths) from skill files. */
export function scanForEndpoints(dir: string): Map<string, Set<string>> {
  const hostPaths = new Map<string, Set<string>>();
  const urlPattern = /https?:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?::\d+)?(\/[^\s"'`)\]}>,]*)?/gi;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!SCAN_EXTENSIONS.has(path.extname(entry.name))) continue;
      if (statSync(entryPath).size > MAX_SCAN_BYTES) continue;
      const text = readFileSync(entryPath, "utf-8");
      for (const found of text.matchAll(urlPattern)) {
        const host = found[1].toLowerCase();
        if (IGNORED_HOSTS.some((pattern) => pattern.test(host))) continue;
        // Placeholder hosts like ${API_HOST} never match the pattern, but a
        // templated path segment can — keep only the static path prefix.
        const rawPath = found[2] ?? "";
        const staticPath = rawPath.split(/[${(]/)[0];
        const paths = hostPaths.get(host) ?? new Set<string>();
        if (staticPath.length > 1) paths.add(staticPath.replace(/\/$/, ""));
        hostPaths.set(host, paths);
      }
    }
  }
  return hostPaths;
}

/** Reduce observed URL paths to at most two coarse rule paths per host. */
export function toRulePaths(paths: Set<string>): string[] {
  const prefixes = new Set<string>();
  for (const observed of paths) {
    const segments = observed.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    // Observed paths are usually prefixes of deeper routes, so grant the
    // subtree; keep the exact path too when it was called bare.
    if (segments.length === 1) prefixes.add(`/${segments[0]}`);
    prefixes.add(`/${segments[0]}/*`);
  }
  const sorted = [...prefixes].sort();
  return sorted.length === 0 || sorted.length > 4 ? ["/*"] : sorted;
}

function snakeCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function renderPolicyBlock(
  skillName: string,
  description: string,
  hostPaths: Map<string, Set<string>>,
  requiresEnv: string[],
): string {
  const key = `skill_${snakeCase(skillName)}`;
  const lines: string[] = [
    "# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.",
    "# SPDX-License-Identifier: Apache-2.0",
    "#",
    `# DRAFT policy block for the \`${skillName}\` skill, generated by`,
    "# scripts/skill-policy-block.mts. Review before applying: hosts are",
    "# inferred from the skill's files, rules default to GET-only, and the",
    "# binaries list is the generic agent-runtime set.",
  ];
  if (requiresEnv.length > 0) {
    lines.push(`# Declared env requirements: ${requiresEnv.join(", ")}`);
  }
  lines.push(
    "",
    "preset:",
    `  name: skill-${skillName}`,
    `  description: ${JSON.stringify(`${skillName} skill: ${description || "network access"}`)}`,
    "",
    "network_policies:",
    `  ${key}:`,
    `    name: ${key}`,
    "    endpoints:",
  );
  for (const [host, paths] of [...hostPaths.entries()].sort()) {
    lines.push(
      `      - host: ${host}`,
      "        port: 443",
      "        protocol: rest",
      "        enforcement: enforce",
      "        rules:",
    );
    for (const rulePath of toRulePaths(paths)) {
      lines.push(`          # TODO review: widen methods only if the skill writes.`);
      lines.push(`          - allow: { method: GET, path: ${JSON.stringify(rulePath)} }`);
    }
  }
  lines.push(
    "    binaries:",
    "      # Generic agent runtimes — trim to what this skill's agent uses.",
    "      - { path: /opt/venv/bin/python3* }",
    "      - { path: /opt/hermes/.venv/bin/python }",
    "      - { path: /usr/local/bin/node }",
    "      - { path: /usr/bin/node }",
    "",
  );
  return lines.join("\n");
}

function main(): void {
  const argv = process.argv.slice(2);
  const write = argv.includes("--write");
  const force = argv.includes("--force");
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (positional.length !== 1) {
    fail("Usage: tsx scripts/skill-policy-block.mts <skill-dir-or-SKILL.md> [--write] [--force]");
  }

  const skillDir = resolveSkillDir(positional[0]);
  const frontmatter = parseFrontmatter(readFileSync(path.join(skillDir, "SKILL.md"), "utf-8"));
  if (!frontmatter.name) fail(`SKILL.md in ${skillDir} has no 'name:' frontmatter.`);
  const metadata = frontmatter.metadata ?? {};
  const requiresEnv =
    (metadata.openclaw ?? metadata.clawdbot ?? metadata.clawdis)?.requires?.env ?? [];

  const hostPaths = scanForEndpoints(skillDir);
  if (hostPaths.size === 0) {
    fail(
      `No candidate endpoints found in ${skillDir}. If the skill's hosts come from env vars, ` +
        "write the block by hand from _template.yaml.",
    );
  }

  const block = renderPolicyBlock(
    frontmatter.name,
    frontmatter.description ?? "",
    hostPaths,
    requiresEnv,
  );

  if (write) {
    const outPath = path.join(skillDir, "policy.yaml");
    if (existsSync(outPath) && !force) fail(`${outPath} exists; pass --force to overwrite.`);
    writeFileSync(outPath, block);
    console.log(`  Wrote ${outPath}`);
    console.log("  Review the TODOs, then apply with:");
    console.log(`    nemoclaw <sandbox> policy add --from-file ${outPath} --yes`);
    console.log(`  Undo later with:`);
    console.log(`    nemoclaw <sandbox> policy remove skill-${frontmatter.name} --yes`);
  } else {
    console.log(block);
  }
}

main();
