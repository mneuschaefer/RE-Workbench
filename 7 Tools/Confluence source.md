# Confluence source selection

After setup, open **Settings → RE Workbench → Confluence source**. Enter your HTTPS Confluence site address, space key and scope, then save. Credentials are configured separately.

The default deployment setting is **Automatic** (`"apiMode": "auto"`). A `*.atlassian.net` site uses the Confluence Cloud v2 API with Basic authentication (account email plus API token). Every other HTTPS host uses the Data Center / self-hosted REST API with Bearer authentication (personal access token). A self-hosted URL may include a context path, for example `https://wiki.example.com/confluence`.

Choose an explicit `cloud` or `server` value only when the automatic rule does not match the deployment. The importer never derives authentication from page content or redirects.

| Scope | What the importer reads |
| --- | --- |
| Entire space (`space`) | All accessible current pages in the space, including pagination and hierarchy. Archived pages and old page versions are not requested. |
| Selected pages and all descendants (`trees`) | The chosen pages and their descendants. Overlapping trees are deduplicated. |
| Only selected pages (`pages`) | Exactly the chosen pages, without descendants. |

The settings form accepts page IDs or full page URLs separated by commas or spaces. The JSON configuration stores numeric IDs as strings in `scope.pageIds`.

Example with automatic routing:

```json
{
  "siteUrl": "https://confluence.example.com",
  "spaceKey": "EXAMPLE",
  "scope": {"mode": "space", "pageIds": []},
  "apiMode": "auto"
}
```

The importer follows pagination and retries rate limiting and temporary service errors with bounded backoff. Authentication failures, denied read access and persistent rate limiting are reported separately. Tokens stay in the configured credential store and are never written to this file.

**Update from sources** downloads the selection before asking whether to replace working files. The replacement preview includes content changes, additions, local-only files and previously known pages no longer returned as current. Confirming replacement adopts the current Confluence page hierarchy, including moves and renames; unavailable pages are removed from working files. Cancel replacement to keep your work; the download remains available for comparison. Switching the selection archives the previous imported files under `5 Archive/Previous sources`. Historical and recovery checkpoints remain separate. Missing pages within the same scope are retained and flagged in source history.

A parent page has a note beside a matching folder containing its children. Source ordering depends on the recommended sorting plugin described in [setup](README.md). The importer reports unsupported non-page content and does not download attachments.
