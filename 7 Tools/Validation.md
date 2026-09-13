# v0.1 validation

Checked on macOS with Obsidian 1.14.1.

- 73 Node tests and 12 Python importer tests passed.
- Three bundled skills passed structural validation.
- A fresh source checkout installed successfully and registered five Workbench commands.
- A network-free synthetic import exercised local editing, comparison, named archiving, replacement cancellation, archived replacement and recovery.
- Comparison and status labels were inspected in Light and Dark mode with the default theme.
- Later documentation and CSS-only changes received link, whitespace and visual checks; behavioural tests were not rerun for those changes.

The suite includes compatibility checks for earlier storage formats and saved UI state. These protect existing files and history; they do not describe additional features in the current interface. UI unit tests use an Obsidian test double, while store tests exercise temporary filesystem and Git data. The test count is not a count of end-to-end user journeys.

A live Confluence connection and real Keychain credential setup remain unverified for this candidate. Remote publication and a downloadable starter package have not been tested. Synthetic tests do not establish live service compatibility.

Test commands are in [technical setup](README.md#verify-a-development-copy).
