# Agent notes — Proseden

Conventions for changes in this repo.

## Form fields for usernames

HTML form controls that ask for another user’s Proseden username must use the field name **`uid`**, not `username`, `user`, `from`, `to`, or similar.

Browsers treat common username field names as login autofill targets. `uid` avoids unwanted autofill while the visible label can still say “User”, “From”, “Invite”, etc.

Accept `uid` on the corresponding POST body (JSON and form-urlencoded). Do not keep legacy aliases unless there is a documented compatibility need.

Examples already following this: view-invite (`name="uid"`), Messages compose (`POST /inbox/send`), purge-inbox-from-user on `/msg`.

Recipient query params for Reply (`?to=`) and manager notice selects (`name="to"` for username-or-`*`) are fine when they are not free-text username fields. This rule targets free-text inputs browsers may treat as login fields.
