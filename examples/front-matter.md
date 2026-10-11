---
title: Front Matter Table
version: 1.0
product: Example
status: Draft
updated: 2026-10-11
owner: platform-team # a comment after a value is not shown
tags: [preview, metadata]
reviewers:
  - auth-team
  - order-team
summary: |
  A block scalar keeps
  its line breaks.
---

# Front Matter Table

This front matter has no `type: design_doc`, so it is shown as a table of its entries at the top of the preview, in the order they are written:

- A list, written as `[a, b]` or as `- item` lines, is joined with commas.
- A block scalar (`|`) keeps its line breaks.
- A comment after a value is left out.

To show the metadata as the document's header instead, write `type: design_doc` in the front matter, as the other examples do.
When `mdDesignDoc.frontMatter` is turned off, the front matter is hidden.
