# v0.1 validation

Checked on macOS with Obsidian 1.14.1.

- 83 Node tests and 26 Python importer tests passed.
- Three bundled skills passed structural validation.
- A fresh source checkout installed successfully and registered five Workbench commands.
- A network-free synthetic import exercised local editing, comparison, named archiving, replacement cancellation, archived replacement and recovery.
- Comparison and status labels were inspected in Light and Dark mode with the default theme.
- Later documentation and CSS-only changes received link, whitespace and visual checks; behavioural tests were not rerun for those changes.

The suite includes compatibility checks for earlier storage formats and saved UI state. These protect existing files and history; they do not describe additional features in the current interface. UI unit tests use an Obsidian test double, while store tests exercise temporary filesystem and Git data. The test count is not a count of end-to-end user journeys.

The contributor reports a successful live Data Center import and visible update preview for the supplied implementation. This integration was tested locally with synthetic Cloud and Data Center responses; no new live connection or credential check was performed. The combined build has not been revalidated against a live Cloud or Data Center service. Remote publication and a downloadable starter package have not been tested. Synthetic tests do not establish live service compatibility.

Test commands are in [technical setup](README.md#verify-a-development-copy).

## Cloud and Data Center integration

- Existing Cloud selection hashes remain compatible when deployment routing is introduced.
- Cached imported wiki links follow moved targets; aliases and heading fragments are preserved. Unowned destination files block import, including when the remote page version changes.
- Both archive choices remove pages absent from the current source collection after explicit replacement. Tests verify edited-file archives, no visible archive on opt-out, retained internal recovery, reopen and recovery replacement, and unchanged attachments.
- Imported source snapshots retain missing-page traceability. API failures abort before replacement; no publication was performed.

The integrated local plugin was installed and reloaded in Obsidian. All five Workbench commands were registered, the Sources folder was hidden in native mode, and Compare with sources opened successfully in the empty starter. This check did not import or replace content. JavaScript syntax, configuration JSON, local documentation links and diff whitespace checks passed.
