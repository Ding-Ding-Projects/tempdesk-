# Review and export records

## Select deployment revisions

Open History in TempDesk Deployer. Combine the action buttons, text or regular expression search, and inclusive local calendar dates. Expand the list with **Show more records**. The session loads up to 2,000 recent revisions. Select all matches includes matching revisions in this loaded set even when their rows have not been expanded yet.

Tick individual checkboxes or Shift-click two checkboxes to select a range. Invert selection flips the current matches. Expand **Selected records** to inspect the revision identifiers and messages before saving. Only selected revisions that still match the filters enter the export.

The UTF-8 JSON history index includes schema version 1, the chosen dates, each revision identifier, timestamp, author, first-line message and action. Diffs, credentials and workspace contents are outside this index. CSV and HTML export the same selected columns, omitting the JSON envelope. CSV protects spreadsheet formulas and uses CRLF. HTML and JSON use LF. These files serve as review copies. Restoring a workspace still uses History's Restore action.

## Read changes and documentation

Open Help, then Changelog. Date and text filters compose. Undated entries appear when no date bounds are set. Export or copy the filtered list to retain its date range and the original Markdown bodies.

Open Help, then Docs, choose an article, and expand **Article contents**. Activating a heading scrolls to that section and moves keyboard focus there. Bundled article links stay inside the reader when the destination exists.

## Review management history

In the management portal, apply the server-side user, action, scope and search filters, then open a record or download JSON. The URL preserves these filters. Previous and Next move between pages of up to 500 matching rows. JSON includes all server-side matches across pages. The separate search inside the displayed list acts on the browser view only.
