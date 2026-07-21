<!-- SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Skill policy blocks

One policy block per skill. The sandbox denies egress by default, so a newly
installed skill whose endpoints are not in the active policy fails at runtime —
usually as an OpenShell 403 the skill author never saw. A skill policy block is
a small preset YAML file that grants exactly the endpoints one skill needs, so
"install a skill" becomes two commands instead of a hand-edit of the sandbox
policy.

## Quick start

```bash
# 1. Install the skill
nemoclaw my-assistant skill install ./skills/github-readonly-live

# 2. Apply its policy block
nemoclaw my-assistant policy add --from-file \
  nemoclaw-blueprint/policies/presets/skills/github-readonly-live.yaml --yes

# 3. Confirm the block is active
nemoclaw my-assistant policy list
```

Undo mirrors install. Custom presets applied with `--from-file` are recorded in
the registry by preset name, so removal needs only the name:

```bash
nemoclaw my-assistant policy remove skill-github-readonly-live --yes
nemoclaw my-assistant skill remove github-readonly-live
```

## Where a block comes from

In priority order:

1. **Shipped with the skill.** Skill authors add a `policy.yaml` next to
   `SKILL.md` using the same format as the files here. `skill install` uploads
   all non-dot files, so the block travels with the skill and documents its
   network needs even before it is applied.
2. **Curated here.** This directory collects reviewed blocks for skills that do
   not ship their own, named `<skill-name>.yaml` after the `name:` field in the
   skill's frontmatter.
3. **Generated.** `tsx scripts/skill-policy-block.mts <skill-dir>` drafts a
   block by reading the skill's `SKILL.md` and scanning its files for
   endpoints. The draft is a starting point for review, not a finished policy.

## Authoring rules

- **Least privilege.** Grant `rules:` with explicit methods and paths; use
  `access: full` only when the skill genuinely needs arbitrary methods.
  Default to `GET`-only and widen deliberately.
- **Exact hosts, port 443, `enforcement: enforce`.** Same defaults as the
  integration presets in the parent directory.
- **Prefix the policy key.** Name the `network_policies` entry
  `skill_<skill_name_snake_case>` and set `preset.name` to
  `skill-<skill-name>`. The prefix prevents collisions with integration
  presets (`github`, `npm`, …) — the merge logic refuses to overwrite a key it
  does not own, and an unprefixed key would conflict.
- **Reuse integration presets when they already cover the skill.** If a skill
  only needs npm, GitHub, or Slack access, apply the existing preset
  (`nemoclaw <sandbox> policy add github`) instead of duplicating it here. Add
  a skill block when the skill needs *narrower* access than the integration
  preset grants (see `github-readonly-live.yaml`, which is GET-only, versus
  the `github` preset's full access plus git) or endpoints no preset covers.
- **No `allowed_ips`.** User-supplied presets that pin IPs are rejected at
  apply time.
- **Validate before committing.** Blocks must conform to
  `schemas/policy-preset.schema.json`.

## Install-time vs. run-time failures

These blocks solve *run-time* egress for installed skills. If the install
itself fails because the registry or ClawHub is blocked, that is the existing
preset story: apply `npm`/`pypi` or onboard with the `balanced` tier first.

## Files

| File | Skill | Grants |
| --- | --- | --- |
| `_template.yaml` | — | Annotated starting point; copy per skill |
| `github-readonly-live.yaml` | `github-readonly-live` | GET-only GitHub REST, repo scope |
| `outlook-email-search.yaml` | `outlook-email-search` | GET-only Microsoft Graph mail read |
