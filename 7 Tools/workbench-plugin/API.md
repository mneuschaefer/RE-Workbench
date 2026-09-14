# RE Workbench store API

`require('./store')` exports `createStore(vaultPath)` `StoreError` and `normalizeContent(content)`. Every
method is asynchronous. References are `sources`, `source:<id>`,
`version:<id>`, or `variant:<id>`.

## Methods

| Method | Result |
| --- | --- |
| `init()` | `{ sourceSnapshotId, versionCount, variantCount }` |
| `captureSources(name?)` | `{ id, name, createdAt, unchanged, entryCount, missingKeys }` |
| `listVersions()` | `[{ id, name, createdAt, sourceSnapshotId, entryCount }]` |
| `createVariant(name, baseRef)` | `{ id, name, baseId, derivedFrom, folder, contentFolder, createdAt }`; `baseRef` accepts any public reference or a raw source ID. |
| `listVariants()` | `[{ id, name, baseId, folder, contentFolder, createdAt, updateStatus }]` |
| `getTree(ref)` | `[{ key, pageId, path, title, contentHash, missing, origin }]` |
| `getRemovedFiles(variantId)` | Removed entries with retained `content`; supports restore of local-only files. |
| `readFile(ref, key)` | `{ key, path, content, contentHash, missing }` |
| `editInVariant(variantId, key)` | `{ key, path, created }` where `path` is vault-relative and lies below the variant's `Content` folder. |
| `addFile(variantId, relativePath, content='')` | `{ key, path }`; `relativePath` is Markdown below `Content` and the stable key is local UUID-based. |
| `markRemoved(variantId, key)` / `restore(variantId, key)` | `{ key, removed }`; records an overlay deletion only. |
| `saveVersion(ref, name)` | `{ id, name, createdAt, sourceSnapshotId, entryCount }` |
| `compare(left, right)` | `{ left, right, added, removed, changed, unchanged, renamed, missing }`; arrays contain stable keys. Renames and moves count as changed; renamed/missing indicators supplement the primary categories. |
| `reviewUpdates(variantId, sourceSnapshotId?)` | `{ variantId, sourceSnapshotId, baseId, reviewToken, items }`; each item is `{ key, status, base, mine, theirs, baseContent, mineContent, theirsContent, decision }`, with status `unchanged`, `source-changed`, `mine-changed`, `both-changed`, `added`, or `missing`. |
| `applyReviewedUpdates(variantId, sourceSnapshotId, choices, reviewToken)` | `{ variantId, sourceSnapshotId, applied, skipped, recoveryVersionId, baseAdvanced }`. `choices` is `{ [key]: 'keep-mine' | 'take-source' | 'mark-reviewed' }`; stale/missing decisions or stale review token throw. `take-source` is invalid for a missing source. |
| `exportChanges(ref)` | `{ ref, files }`; `files` is `[{ key, path, content, status }]`, excluding notes outside the variant Content folder. `status: missing` has null content and must block export, never produce an empty file. |

Source snapshots capture `6 Import log/Confluence/manifest.json` and the listed
Markdown files. Their stable key is `page:<Confluence page id>`, so a renamed
or moved page remains one item. A source page missing from a later manifest is
retained and marked missing. Variant overlay files only materialize under
`3 Drafts/Variants/<safe-name-id>/Content`; notes outside that folder are not
part of a variant tree or export. New Markdown files inside Content receive stable local identities automatically. Missing working files prevent saving a named version (`WORKING_FILE_MISSING`); restore or explicitly remove them first. Duplicate names are rejected; snapshots and
versions are immutable.

`applyReviewedUpdates` makes a recovery version before any accepted source
choice, and requires the reviewed source snapshot to still be current. It does
not silently merge `both-changed` files.

## Persistence boundaries

Public operations are serialized per store instance. Handled write failures restore touched working files and prior state; update application first preserves a recovery version. Git refs retain saved and variant blobs. This is not a multi-process lock or a crash-atomic multi-file transaction.

Normalization removes known importer provenance for comparisons and newly materialized working copies, preserving business properties and content. Source blobs and saved raw content remain unchanged. Internal normalization metadata migrates independently. Users do not maintain tags, identifiers or status fields.

## Native working tree

`createVariant(name, baseRef, {nativeWorking:true})` reserves `1 Working files`; a nonempty unowned folder or existing native variant is rejected. Materialize all entries with `editInVariant` once. Native missing working files are treated as local deletions; legacy sparse-variant missing-file behavior is unchanged.

`nativeWorkingToken(id)` captures current tree state. `replaceNativeWorking(id, targetRef, token)` rejects stale confirmation, saves a recovery version, then replaces tracked Markdown transactionally. Source entries flagged as missing remain in source history but are omitted from the explicitly replaced working tree; the result reports `removedUnavailable`. The returned `recoveryVersionId` is restorable by the same operation. Empty managed directories are pruned, while non-Markdown files and their directories are untouched. Native UI confirmation is required before replacement.

### Archive before replacement

`replaceNativeWorking(id, targetRef, token, options={})` defaults to archiving changed and added Markdown under `5 Archive/Working changes/<timestamp>-<unique suffix>/Files`. `options.archiveFolder` selects a safe vault-relative folder; `options.archive:false` explicitly skips this file archive. Both modes retain a recovery version. Deleted paths are recorded in Changes.json. Archive writing and verification complete before working replacement; failure leaves working files intact. The result includes `archivePath` or null.

Public tree entries expose `parentId` (Confluence parent page ID, or null) for native root navigation. This is existing snapshot metadata, not a new checkpoint or storage migration.

### Readable native filenames

`useReadableNativePaths(id)` performs a one-time transactional path migration and returns `{moves}`. It saves a complete pre-migration version, copies the existing working bytes unchanged, preserves deletions and retains source paths and keys. `workspacePath` is exposed on materialized public entries and must be used when opening a working file. `path` remains the logical source identity path. The internal `readablePaths` mapping also controls future replacement; duplicates receive ordinary numeric suffixes. No snapshot content is rewritten and no explorer title override is needed. Imported source links continue to resolve through the source-to-working mapping. Existing links to old working filenames outside this mapping require review when migrating another vault.

### Native rename identity

`recordNativeRename(id, oldPath, newPath)` records an already-completed Obsidian file or folder rename within the native working root. It preserves keys and content, handles a scan that ran before the event, and removes only the temporary local identity at that destination. `renamedFrom` retains the initial working path; returning there clears the rename marker. Copies retain independent identities.

`resolveNativeRenames(id)` returns `{token,pairs,unresolved}` for unique byte-identical removed-source/added-local pairs. `resolveNativeRenames(id, token)` verifies the current tree and reconnects those pairs after a checkpoint; it never alters file content. No automatic content-based matching runs during ordinary sync.

Comparisons, source review and archive selection count local path changes alongside content changes. Renamed exports carry `previousPath` and `currentPath`; the UI writes their current filenames and a rename record. Saved versions retain rename identity and paths when restored into native mode. The inactive-plugin recovery tool does not yet support manually pairing edited or ambiguous candidates.

### Source order

Optional manifest capability `ordering: source` enables per-page `source_order` arrays (numeric positions, with textual ancestor fallback where needed). Public entries expose `sourceOrder`. Source capture detects order-only changes and retains them in immutable snapshots; compare/export ignore them as content changes.

`applySourceOrder(nativeVariantId)` adopts current source order for matching identities without advancing the content baseline. The variant’s internal `sourceOrderByKey` controls visible order. Saved versions capture it; replacement restores target order. The optional sorting bridge consumes it alongside current workspacePath, so local renames retain their source position.

## Article content and visible identity

`normalizeContent(content, keepIdentity=false)` excludes generated provenance from comparisons. Materialization passes `true` to retain the two flat `rewb-id` and `rewb-source` fields as native Properties. They are informational, not an identity-reassignment API. Original body headings and business text are preserved. Import manifest `content_format` forces reconversion after a converter-format change without editing old snapshots. The file-export UI has been removed; store.exportChanges remains an internal change inventory used by review and recovery.

`rewb-import-warning`, when present, is also Workbench metadata: it flags source elements needing a conversion check and is excluded from article comparison. The full original remains available through `rewb-source`.

## Automatic history retention

`pruneAutomaticHistory(limit)` accepts a positive integer and removes excess explicitly automatic records from history metadata and their Git refs. The plugin interprets 0 as unlimited and does not call pruning. New source captures without a supplied name and internal recovery checkpoints are marked automatic; user-named versions are not. Legacy records without this flag are retained, never classified by their name.

The newest N automatic records per category (sources and recovery versions) are kept. Current source, variant baselines/review references and sources used by retained versions are protected additionally. Named archive directories and reports are untouched. A metadata backup is written before pruning; state-save failure keeps old state and refs. Ref-cleanup failures are reported as pending; object space is reclaimed only by later Git maintenance, not aggressive pruning during editing. Do not promise an immediate disk-space cap.

## Empty starter

Before the first import, `captureSources()` accepts an absent manifest and stores an empty internal snapshot marked `starterBootstrap`. It can reopen that starter without creating a manifest on disk. A malformed manifest, or a missing manifest after a real import, remains an error. The first import does not automatically replace working files.
