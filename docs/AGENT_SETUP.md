# Use the video skill in your agent

Official client documentation checked on 2026-10-05. The runtime needs local Node, Chrome/Chromium, FFmpeg and ffprobe; installing a skill does not install those tools. Native discovery below is documented, not run-tested here. The verified workflow used the existing Codex desktop agent reading the skill explicitly and creating a new video with two JSON revisions.

Copy the complete `agent-motion-studio` folder, including `references`, into your **video project's** skill directory. Use one location per client. These instructions do not modify global configuration or install anything automatically.

| Client | Project destination | Discover or invoke | Source |
| --- | --- | --- | --- |
| Codex | `.agents/skills/agent-motion-studio/` | In CLI/IDE use `/skills` or mention `$agent-motion-studio`; desktop surfaces provide their skill selector. | [Official OpenAI documentation](https://learn.chatgpt.com/docs/build-skills) |
| Claude Code | `.claude/skills/agent-motion-studio/` | Start Claude Code in the project; use `/agent-motion-studio`. | [Claude Code skills](https://code.claude.com/docs/en/skills) |
| Cursor | `.cursor/skills/agent-motion-studio/` | Open the project, inspect discovered skills in Customize, and select `/agent-motion-studio` in Agent chat. | [Cursor skills](https://cursor.com/docs/skills) |
| Gemini CLI | `.gemini/skills/agent-motion-studio/` | In a trusted project use `/skills list`, then `/skills reload` if needed. Ask to use `agent-motion-studio`; review the client's activation prompt. | [Gemini CLI tutorial](https://geminicli.com/docs/cli/tutorials/skills-getting-started/) |
| Antigravity | `.agents/skills/agent-motion-studio/` | Open the project and inspect Customizations; mention the skill by name. Newer surfaces also document `/agent-motion-studio`. | [Antigravity skills](https://antigravity.google/docs/skills?app=antigravity-ide) |

For example, from a project with the npm package installed:

```powershell
$studioSkillSource = (Resolve-Path "node_modules/agent-motion-studio/skills/agent-motion-studio").Path
$studioSkillParent = ".claude/skills" # Choose the destination from the table.
$studioSkillTarget = Join-Path $studioSkillParent "agent-motion-studio"
if (Test-Path -LiteralPath $studioSkillTarget) { throw "Skill already exists; inspect it before replacing." }
New-Item -ItemType Directory -Force -Path $studioSkillParent | Out-Null
Copy-Item -LiteralPath $studioSkillSource -Destination $studioSkillTarget -Recurse
```

In the source checkout, the source is `skills/agent-motion-studio`. Existing `.agents` configuration is preserved by this implementation; these are optional installation instructions for the user's project.

Give the agent a concrete brief:

> Use agent-motion-studio. Create a 15-second 9:16 promo from my supplied image and text. Use the kinetic style and local procedural music. Write a storyboard, edit the manifest, render, inspect frames and transitions, and return the MP4 and report. Then replace the opening title with my new text, keeping scene IDs, and shorten the product scene by two seconds. Verify both revisions.

If a client's native discovery is unavailable, provide the absolute path to `skills/agent-motion-studio/SKILL.md` and ask it to read that file and its referenced guides explicitly. Also provide the CLI location: `node <checkout>/dist/cli.js` or `npx --no-install agent-motion-studio` from the installed consumer. This explicit-read fallback does not establish native compatibility.

For a real client acceptance run, retain client/version/model when exposed, the brief, manifest revisions, exact commands/cwd/exit codes, affected frames and decoded MP4s. A skill appearing in a menu proves discovery only. Do not report another client's success from this project's Codex run.
