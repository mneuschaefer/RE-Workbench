# Setup and technical reference

[README](../README.md) explains the workflow. This checklist covers the first installation and the plugins that make the workspace easier to use.

## Setup checklist

This public beta assumes basic Obsidian knowledge, access to the project's Confluence Cloud space and an active AI agent with an advanced model, local file access and tool execution for guided setup. Accounts and models are not included. Manual setup is available for users comfortable following the technical steps. macOS is the supported setup; other platforms need adaptation and testing.

- Use a dedicated vault for one collaborative project and one Confluence space. Do not install the Workbench into a general-purpose or multi-project vault.

- Install desktop Obsidian, Git, Node.js and Python 3 on macOS. Check that `git --version`, `node --version` and `python3 --version` work in Terminal.
- Install the bundled RE Workbench plugin and Python dependencies using the commands below.
- Open this folder as an Obsidian vault and enable RE Workbench under **Settings → Community plugins**.
- Install **Custom File Explorer sorting** through Community plugins. **File Color** is optional. Configure any installed plugins as described below.
- Keep **Show inline title** on and **Properties in document** visible under **Settings → Editor**.
- If you want to insert templates manually, enable Obsidian's core **Templates** plugin and set its folder to `2 Templates`.
- Set up your Confluence selection and Keychain item with the [Confluence workflow skill](Skills/confluence-workflow/SKILL.md). Test reading before the first import.
- Import a small selection, open a working note and check the comparison. Confirm source ordering and colour readability in your chosen theme.

## Install the local plugin

Run these commands from the extracted repository folder:

```sh
python3 -m venv "7 Tools/.confluence-runtime"
"7 Tools/.confluence-runtime/bin/python" -m pip install -r "7 Tools/requirements.txt"
node "7 Tools/workbench-plugin/install-local.js"
```

The installer creates `1 Working files` if absent and copies this project's runtime files into `.obsidian/plugins/re-workbench-local`. Enable or reload RE Workbench afterwards. It does not install optional plugins or change their settings. To update the local plugin after changing its source, run the installer again.

## Recommended Obsidian plugins

RE Workbench handles imports, comparison and archives. Custom File Explorer sorting is recommended; File Color and Commander are optional. Install these third-party plugins through **Settings → Community plugins → Browse**. RE Workbench itself is installed from this repository.

| Plugin | Include it when | Setup |
| --- | --- | --- |
| **RE Workbench** (`re-workbench-local`) | Required for the Workbench actions. | Install from this repository using the command above. |
| [Custom File Explorer sorting](https://github.com/SebastianMC/obsidian-custom-sort) (`custom-sort`) | Recommended to keep files and folders in Confluence order. | Set the additional sorting specification file to `7 Tools/Source order.md` and enable sorting. RE Workbench generates this file when applying source order. |
| [File Color](https://github.com/ecustic/obsidian-file-color) (`obsidian-file-color`) | Optional: gently highlight the working area. | Apply the supplied preset only to `1 Working files`, with background colouring and inheritance. All other folders stay uncoloured. |
| [Commander](https://github.com/phibr0/obsidian-commander) (`cmdr`) | Optional if you want buttons for frequent actions. | Add **Compare with sources**, **Update from sources** and **Archive working files** to your preferred toolbar. The command palette already provides these actions. |

File Color is optional. The demo highlights only `1 Working files` and its contents in blue. Change the colour in the File Color plugin settings to suit your preferences; the other folders keep their normal appearance.

[Obsidian defaults](obsidian-defaults.json) contains the preset for repeatable setup. The highlight identifies the working area; change labels indicate actual edits. All Workbench functions work without colour.

The current demo used Custom File Explorer sorting 3.2.0 and File Color 1.1.0. These are reference versions, not a compatibility guarantee for every theme or future version. RE Workbench can compare and archive without them; disabling sorting returns the explorer to its normal order. New local files without a source position sort alphabetically. The generated order file may flag names the sorting plugin cannot represent.

QuickAdd, File Diff and Read-only View are not needed for this setup. A custom theme, icon plugin and CSS snippets are also optional; the starter does not bundle them. Folder colours do not protect files from edits.

For optional writing, diagramming and image tools, see [recommended extras for RE and BA work](../README.md#recommended-extras-for-re-and-ba-work). The list separates AI-agent skills from Obsidian plugins; these are recommendations, not setup dependencies.

## Working-file details

The **Changed** marker tracks edits since the working files were last replaced. **Source updated** means the downloaded source has moved on since that point. These markers can remain after manually transferring an edit to Confluence. The comparison always uses the latest successful download.

Rename and move notes normally within `1 Working files`. For files renamed while the plugin was inactive, **Reconnect renamed files** can reconnect unambiguous matches. Copies count as new files. Leave the `rewb-id`, `rewb-source` and `rewb-import-warning` Properties unchanged; edit the article below them.

## Connection settings

The setup skill creates two local files:

- `7 Tools/confluence-source.json`: site URL, space key and selected pages. The plugin's **Confluence source** settings edit the same file.
- `7 Tools/.local/confluence.json`: email, credential-helper path and credential-store references. It contains no token.

The starter supplies `keychain-helper.sh` for macOS Keychain. It implements the launcher's existing helper contract; the environment variable names beginning with `BWS_` are retained for compatibility and do not require Bitwarden. Existing installations may keep their trusted helper.

[Confluence source selection](Confluence%20source.md) describes the supported scopes. The [setup skill](Skills/confluence-workflow/SKILL.md) contains the exact configuration and reading test.

## Verify a development copy

Run from the repository root:

```sh
node --test "7 Tools/workbench-plugin/"*.test.js
"7 Tools/.confluence-runtime/bin/python" "7 Tools/test_confluence_import.py"
```

Before distributing a starter, install it in a fresh vault and check the visible commands, an initial import, a local edit and comparison, named archiving and replacement cancellation. Check recommended plugin ordering and colour readability in Obsidian. Record only checks actually performed in the [validation record](Validation.md).

Read [the store API](workbench-plugin/API.md) before modifying storage. Internal history, manifests and checksums carry identity and recovery information; use public store methods to change them.

## Package the starter

Version 0.1.0 includes the local Confluence workflow. Demo content must be independently authored fiction. Wiki and retrieval extensions are outside this release.

Use reviewed source files as the distribution source. Never ZIP a used vault. Git ignore rules do not filter a manually created ZIP; packaging must use an explicit allowlist.

| Artifact | Contents |
| --- | --- |
| GitHub source project | RE Workbench source, tests, documentation, example skills and templates, configuration presets, synthetic screenshots and the MIT license. No installed plugins or local vault data. |
| Downloadable starter vault | User-facing README and setup instructions, AGENTS.md and CLAUDE.md, example skills and templates, RE Workbench runtime source and installer, importer and its dependency list, optional configuration presets and LICENSE. No developer tests, repository screenshots, internal review notes or changelog. |

Both artifacts exclude credentials, site configuration, imported sources, working documents, private notes, archives, import reports, history, caches and machine settings. The default starter is empty; any later example content must be independently written fiction and separately reviewed.

Third-party plugins are not bundled. Install Custom File Explorer sorting through Obsidian; File Color and Commander are optional. The configuration preset can be applied after installation. Obsidian, Node and Python are separate installations, and Python dependencies are installed from requirements.txt. RE Workbench's own plugin source remains included so the local installer can work.

The demo ZIP still requires the owner's hands-on test and explicit confirmation before generation. No ZIP has been generated. Its final allowlist, version and contents must be reviewed before publication. Adapt the starter README to its actual contents: omit repository-only screenshots and developer links, and verify every remaining local link.
