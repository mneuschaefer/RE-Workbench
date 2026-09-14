# Setup and technical reference

[README](../README.md) explains the workflow. This checklist covers the first installation and the plugins that make the workspace easier to use.

## Setup checklist

This public beta assumes basic Obsidian knowledge, access to the project's Confluence Cloud or Data Center/self-hosted space and an active AI agent with an advanced model, local file access and tool execution for guided setup. Accounts and models are not included. Manual setup is available for users comfortable following the technical steps. macOS is the supported setup; other platforms need adaptation and testing.

- Use a dedicated vault for one collaborative project and one Confluence space. Do not install the Workbench into a general-purpose or multi-project vault.

- Install desktop Obsidian, Git, Node.js and Python 3 on macOS. Check that `git --version`, `node --version` and `python3 --version` work in Terminal.
- Install the bundled RE Workbench plugin and Python dependencies using the commands below.
- Open this folder as an Obsidian vault and enable RE Workbench under **Settings → Community plugins**.
- On a fresh vault, install and configure the **Demo workspace profile** below: Custom File Explorer sorting, File Color and Commander alongside RE Workbench. Respect explicit opt-outs and preserve every existing optional-plugin choice on later runs.
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

RE Workbench handles imports, comparison and archives. Use the demo workspace profile below for guided setup; File Color and Commander remain optional when the user prefers a minimal UI. Install these third-party plugins through **Settings → Community plugins → Browse**. RE Workbench itself is installed from this repository.

| Plugin | Include it when | Setup |
| --- | --- | --- |
| **RE Workbench** (`re-workbench-local`) | Required for the Workbench actions. | Install from this repository using the command above. |
| [Custom File Explorer sorting](https://github.com/SebastianMC/obsidian-custom-sort) (`custom-sort`) | Recommended to keep files and folders in Confluence order. | Set the additional sorting specification file to `7 Tools/Source order.md` and enable sorting. RE Workbench generates this file when applying source order. |
| [File Color](https://github.com/ecustic/obsidian-file-color) (`obsidian-file-color`) | Optional: gently highlight the working area. | On first setup only, apply the supplied preset to `1 Working files` when the user has no existing colour choice. Never replace an existing assignment or re-enable an intentionally disabled or removed plugin. |
| [Commander](https://github.com/phibr0/obsidian-commander) (`cmdr`) | Optional if you want buttons for frequent actions. | Apply the five editor buttons from the demo workspace profile below. |

File Color is optional. The initial demo preset highlights only `1 Working files` and its contents in blue. Change or remove the colour in the File Color plugin settings to suit your preferences; the other folders keep their normal appearance. RE Workbench does not manage File Color at runtime, so installing or reloading Workbench and running **Update from sources** leave those choices unchanged.

[Obsidian defaults](obsidian-defaults.json) contains the preset for repeatable setup. The highlight identifies the working area; change labels indicate actual edits. All Workbench functions work without colour.

The current demo used Custom File Explorer sorting 3.2.0 and File Color 1.1.0. These are reference versions, not a compatibility guarantee for every theme or future version. RE Workbench can compare and archive without them; disabling sorting returns the explorer to its normal order. New local files without a source position sort alphabetically. The generated order file treats a page note and its same-named child folder as one ordering item, so they stay adjacent in the explorer. When a Data Center/self-hosted API does not expose non-negative page positions, RE Workbench preserves the order returned by the parent's child-page endpoint. The generated order file may flag names the sorting plugin cannot represent.

QuickAdd, File Diff and Read-only View are not needed for this setup. A custom theme, icon plugin and CSS snippets are also optional; the starter does not bundle them. Folder colours do not protect files from edits.

For optional writing, diagramming and image tools, see [recommended extras for RE and BA work](../README.md#recommended-extras-for-re-and-ba-work). The list separates AI-agent skills from Obsidian plugins; these are recommendations, not setup dependencies.

## Demo workspace profile

For a fresh setup like the demo, install and enable **RE Workbench**, **Custom File Explorer sorting**, **File Color** and **Commander**. Use this profile for the first README setup request unless the user asks for a minimal setup or declines a visual option. These are four plugins; installing them alone does not apply their settings. On every later setup or update run, treat the current state of optional plugins as the user's choice: do not reinstall, re-enable or reset them. File Color remains optional for users who do not want colour, and Commander is optional for users who do not want editor buttons.

Apply [obsidian-defaults.json](obsidian-defaults.json) after installing the plugins:

- `plugins.custom-sort`: additional sorting specification = `7 Tools/Source order.md`; sorting enabled (`suspended: false`); automatic bookmark ordering off. After Workbench generates the file, run **Custom File Explorer sorting: Enable custom sorting** from the command palette. Do not hand-edit generated page rules.
- `plugins.obsidian-file-color`: only when configuring a fresh vault with no existing File Color preference, add the palette entry and assignment for `1 Working files`, then enable background colour and inheritance. If the plugin already has any assignment for `1 Working files`, preserve its colour, palette, inheritance and background choices. If File Color is disabled, absent or has no assignment because the user removed it, leave that state unchanged on later runs.
- `plugins.cmdr`: add the five `pageHeader` entries in the supplied order: **Heading**, **Bold**, **Italic**, **List**, **Link**. These map to native editor commands. Preserve existing buttons and avoid duplicate command IDs. Workbench supplies its own actions; do not add another set of Workbench buttons by default.
- `editor`: apply to Obsidian's editor settings, with inline title on and Properties visible. Enable core **Files** for the left explorer and core **Templates** with folder `2 Templates` if templates are wanted.

The JSON is a first-setup configuration reference, not an Obsidian auto-import file. Prefer the installed plugins' settings UI. For offline configuration of a fresh vault, close Obsidian first, back up existing settings, then merge only settings for which the user has no prior choice. Never apply the File Color object when its configuration already exists or when the plugin is intentionally disabled or absent. Merge arrays by command ID, palette ID or folder path; never replace unrelated personal settings. Reopen the vault and verify the result. Do not copy another vault's entire `.obsidian` directory or its workspace layout.

### What the development vault has installed

| Plugin / appearance | Role in the current development vault | Fresh setup |
| --- | --- | --- |
| RE Workbench (`re-workbench-local`) | Working-file actions, status labels and hiding the duplicate Sources tree after native mode initializes. | Required. |
| Custom File Explorer sorting (`custom-sort`) | Imported page and folder order. | Include in demo profile. |
| File Color (`obsidian-file-color`) | Subtle working-tree background. | Include in demo profile; user may omit. |
| Commander (`cmdr`, reference version 0.5.12) | Five editing buttons above notes. | Include in demo profile; user may omit. |
| File Diff (`file-diff`) | Earlier separate comparison workflow. | Legacy; Workbench already compares sources. |
| QuickAdd (`quickadd`) | Earlier compare/import macros. | Legacy; do not recreate old macros. |
| Read-only View (`read-only-view`) | Reading-mode convenience for source notes. | Not required for working mode; not filesystem protection. |
| Obsidian Nord theme | Development vault appearance. | Optional under Appearance → Themes; preserve the user's theme unless matching Nord is requested. |
| `rewb-demo` CSS snippet | Presentation-note formatting in the development vault. | Not needed for explorer order, working-file hiding or editor buttons. |

Folder Notes and icon plugins are not installed in this reference vault. They are not missing setup dependencies. Theme, fonts and operating-system rendering can change the appearance; installing all seven development plugins does not recreate the UI by itself.

### Verify the visible result

Do not report setup complete based only on the installed-plugin list. Record each check as passed, failed or not tested:

1. RE Workbench is **enabled and loaded**, and **Open working files**, **Compare with sources**, **Update from sources**, **Archive working files** and **Reconnect renamed files** appear in the command palette.
2. The installer has created `1 Working files`. In active native working mode, `1 Sources` and legacy `3 Drafts` are hidden. The numbered visible folders appear as `1 Working files`, `2 Templates`, `4 Notes`, `5 Archive`, `6 Import log`, `7 Tools` with normal name sorting. Repository support files such as `assets`, `AGENTS`, `CLAUDE` and `README` can remain visible; no extra hiding plugin is required.
3. After an authorized import and accepted working-file creation, `1 Working files/Confluence` contains editable notes. Compare a known sibling sequence with Confluence and confirm that `7 Tools/Source order.md` exists and custom sorting is active. An empty starter cannot prove source ordering; mark that check pending rather than manufacturing source content.
4. A working note shows the five Commander buttons in order, its inline title and Properties. If File Color is used, the working folder and descendants have the subtle background in the user's theme, including hover and selection.
5. Open **Compare with sources** and confirm it loads. A read-only connection dry-run and a configured UI are separate checks; report both accurately.

If `1 Sources` is visible while `1 Working files` is missing, check the target vault path, rerun the local installer, enable/reload RE Workbench and inspect its startup error and Git availability. An installed plugin may not have initialized. Do not fix this by renaming Sources, manually copying source files, altering history or installing more appearance plugins. If the working folder exists but is empty, distinguish an empty starter from a failed import; first import/replacement still follows the normal review flow.

## Working-file details

The **Changed** marker tracks edits since the working files were last replaced. **Source updated** means the downloaded source has moved on since that point. These markers can remain after manually transferring an edit to Confluence. The comparison always uses the latest successful download.

Rename and move notes normally within `1 Working files`. For files renamed while the plugin was inactive, **Reconnect renamed files** can reconnect unambiguous matches. Copies count as new files. Leave the `rewb-id`, `rewb-source` and `rewb-import-warning` Properties unchanged; edit the article below them.

## Connection settings

The setup skill creates two local files:

- `7 Tools/confluence-source.json`: site URL, deployment routing, space key and selected pages. The plugin's **Confluence source** settings edit the same file. Automatic routing selects Cloud for `*.atlassian.net` and Data Center/self-hosted for other HTTPS hosts.
- `7 Tools/.local/confluence.json`: optional Cloud account email, credential-helper path and credential-store references. It contains no token. The email is required only for Cloud; self-hosted access uses the stored token as a Bearer token.

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
