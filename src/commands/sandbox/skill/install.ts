// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { Args, Flags } from "@oclif/core";
import { installSandboxSkill } from "../../../lib/actions/sandbox/skill-install";
import { yesFlag } from "../../../lib/cli/common-flags";
import { NemoClawCommand } from "../../../lib/cli/nemoclaw-oclif-command";

export default class SkillInstallCliCommand extends NemoClawCommand {
  static id = "sandbox:skill:install";
  static strict = true;
  static summary = "Deploy a skill directory to the sandbox";
  static description = "Validate a local SKILL.md directory and upload it to a running sandbox.";
  static usage = ["<name> <path> [--with-policy [--yes|-y]]"];
  static examples = [
    "<%= config.bin %> sandbox skill install alpha ./my-skill",
    "<%= config.bin %> sandbox skill install alpha ./my-skill/SKILL.md",
    "<%= config.bin %> sandbox skill install alpha ./my-skill --with-policy --yes",
  ];
  static args = {
    sandboxName: Args.string({
      name: "sandbox",
      description: "Sandbox name",
      required: true,
    }),
    skillPath: Args.string({
      name: "path",
      description: "Skill directory or direct path to SKILL.md",
      required: true,
    }),
  };
  static flags = {
    "with-policy": Flags.boolean({
      description:
        "Apply the skill's network policy block (policy.yaml next to SKILL.md, or a curated block in policies/presets/skills/) after install",
    }),
    yes: yesFlag("Skip the policy confirmation prompt (only with --with-policy)"),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(SkillInstallCliCommand);
    await installSandboxSkill(args.sandboxName, {
      command: "install",
      path: args.skillPath,
      withPolicy: flags["with-policy"],
      yes: flags.yes,
    });
  }
}
