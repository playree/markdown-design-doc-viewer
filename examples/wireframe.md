---
type: design_doc
title: Sign-in Screen Design
version: 1.0
product: Example
status: Draft
updated: 2026-10-26
---

# Sign-in Screen Design

A wireframe is an HTML file put into the document like an image. Its parts are numbered with `data-item` in the HTML, and linked to the rows of the item table and to the headings numbered like them.

## Screen

<!-- wireframe: link-headings width=375 -->
[Sign-in screen](screens/login.html)

<!-- table: item=No merge=Item,Name -->
| No | Item | Name | Type | Required | Notes |
|---|---|---|---|---|---|
| 1 | Member ID | `memberId` | Text box | ✓ | 4–20 letters and digits. |
| 2 | Password | `password` | Password box | ✓ | 8–64 characters, masked. |
| 3 | Keep me signed in | `remember` | Check box | | Off by default. |
| 4 | Sign in | `signIn` | Button | | |
| 5 | Forgot your password? | `forgot` | Link | | |
| 6 | Error message | `error` | Text | | Shown when the sign-in fails. |

### 4. Sign in

1. Checks that the member ID and the password are entered.
2. Calls the sign-in API with them.
3. On success, opens the top page; with **Keep me signed in**, the session lasts 30 days.

### 5. Forgot your password?

Opens the password reset screen ([password-reset.md](password-reset.md)).

### 6. Error message

Shown above the form when the sign-in API returns 401. The password box is cleared.

<!-- link-headings:end -->

## Notes

- The wireframe is only a layout: the colors and fonts of the real screen follow the design system.
