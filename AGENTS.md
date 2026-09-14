# RE Workbench: agent instructions

## Sources of truth

- User workflow and setup entry: `README.md`. Do not create another Home or Guide.
- Technical setup: `7 Tools/README.md`. Store contracts: `7 Tools/workbench-plugin/API.md`.
- Setup, import and repair procedure: `7 Tools/Skills/confluence-workflow/SKILL.md`. Read it for those tasks; reuse existing functions.
- No standalone changelog is needed for v0.1. Record implementation milestones, responsible agent/model and actual checks in the ignored local `7 Tools/.local/development-log.md`. Keep public validation factual in `7 Tools/Validation.md`; do not publish internal review notes.

## Product and content

- Version 0.1 requires one dedicated requirements-workbench vault per collaborative project, connected to one Confluence space. Do not configure multiple projects or spaces inside a general-purpose vault.

- Follow current user decisions. Guidance, folders and UI use concise English; preserve imported source language and article content.
- Prefer native Obsidian and maintained optional plugins. No duplicate file browser, version picker or restore UI. The only custom view is Compare with sources.
- Edit under `1 Working files`. Keep `1 Sources` untouched except through the explicit importer. Hidden folders and colours are navigation aids, not protection.
- Keep private notes in `4 Notes`. Preserve source attribution. Archive obsolete material rather than deleting it.
- Source updates, named archives and comparisons are separate actions. No silent background sync or automatic publication.
- Named archives are ordinary Markdown folders under `5 Archive/Versions`, with an optional date suffix. Never overwrite an existing archive. Reuse is manual; attachments are outside this MVP operation.

## Identity and safe replacement

- Read the store API before changing storage. Never edit `.rewb-history/state.json`, saved objects or checksums to disguise changes. Preserve immutable checkpoints.
- Native working files form a complete managed tree: missing files are deletions. Copies are additions. Preserve identity through `recordNativeRename`; explicit `resolveNativeRenames` handles only supported unambiguous pairs.
- Use public `workspacePath` to open working files. Do not infer paths from source filenames or reintroduce explorer-only title overrides.
- `rewb-id`, `rewb-source` and `rewb-import-warning` are informational Properties; internal identity remains authoritative. Do not reassign identity by editing frontmatter.
- Replacement must use `replaceNativeWorking` with a fresh token and explicit user choice. Archive by default; `archive:false` requires explicit overwrite-without-archiving selection. Archive failures prevent replacement. Retain internal recovery even without a file archive. After a successful complete download, explicit replacement removes working pages no longer returned by the source; an unsuccessful download must never trigger replacement.
- Keep source ordering separate from article content. Use the existing optional sorting plugin and generated `7 Tools/Source order.md`; do not patch explorer sorting or encode order in filenames.
- Legacy `2 Saved versions` projections are not sources, working files or knowledge inputs. Removing a projection must never delete history.

## Boundaries and verification

- Secrets stay in credential stores and trusted child processes, never chat, notes, scripts or distributable files. Setup uses GET-only dry-run; never write a remote test page.
- No external writes without explicit authorization. The plugin itself does not publish. An explicitly authorized agent may use a connector or targeted API operation under the Confluence skill; a separate pre-installed writer is not required. Enforce remote version conditions, preserve the pre-write remote content, and never roll back across intervening edits.
- Test this vault before packaging. Do not distribute local history, credentials, machine configuration or customer content. Current setup is Mac-specific; crash-atomic writes and multi-process coordination are not implemented.
- After changing paths or UI settings, verify links and visible commands in Obsidian. Run tests relevant to the change; keep the toolbar small and theme-dependent appearance optional.

## Retention and report configuration

- Publishing report location comes from the plugin's publishReportFolder setting, appended to generated prompts. Do not hardcode the demo path in custom instructions.
- Automatic history retention must use pruneAutomaticHistory, never direct state edits. Only explicitly automatic records are eligible; named and unclassified legacy records, active baselines and sources referenced by retained versions remain protected. File archives and publishing reports are outside this retention policy.

## Writing skills

The user-story and use-case skills are examples and placeholders. Follow project-specific RE guidance over these examples; adapt or replace them and add project tools when requested. Do not treat example formats as mandatory standards.

- For user stories and acceptance criteria, read `7 Tools/Skills/user-stories/SKILL.md`.
- For use cases and scenario flows, read `7 Tools/Skills/use-cases/SKILL.md`.
- Keep assumptions and unanswered questions explicit. Local writing is not permission to publish.
- `CLAUDE.md` only references this file; maintain agent rules here.

## Release 0.1 scope

- Version 0.1 (plugin `0.1.0`) covers the local Confluence workflow.
- Exclude experimental wikis, knowledge-extension skills, generated knowledge corpora, experiment source inventories and vector indexes from the release vault. Keep these on the roadmap for a later release.
- Use only independently authored fictional demo content without recognizable project details. Never copy the development vault or its archives wholesale.
- Generate the demo ZIP only after the owner has tested the local candidate and explicitly confirmed packaging.

- Do not bundle third-party plugins in the repository or downloadable starter. Document installation through Obsidian and provide optional configuration presets only. Build future downloads from an explicit allowlist; exclude developer tests, screenshots, internal review records and local state from the user vault. Retain the project LICENSE and required runtime source files.
