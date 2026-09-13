# Confluence source selection

After setup, open **Settings → RE Workbench → Confluence source**. Enter your HTTPS Atlassian site address, space key and scope, then save. Credentials are configured separately.

| Scope | What the importer reads |
| --- | --- |
| Entire space (`space`) | Accessible current pages in the space, including pagination and hierarchy. |
| Selected pages and all descendants (`trees`) | The chosen pages and their descendants. Overlapping trees are deduplicated. |
| Only selected pages (`pages`) | Exactly the chosen pages, without descendants. |

The settings form accepts page IDs or full page URLs separated by commas or spaces. The JSON configuration stores numeric IDs as strings in `scope.pageIds`.

**Update from sources** downloads the selection before asking whether to replace working files. Cancel replacement to keep your work; the download remains available for comparison. Switching the selection archives the previous imported files under `5 Archive/Previous sources`. Historical checkpoints remain separate. Missing pages within the same scope are retained and flagged.

A parent page has a note beside a matching folder containing its children. Source ordering depends on the recommended sorting plugin described in [setup](README.md). The importer reports unsupported non-page content and does not download attachments.
