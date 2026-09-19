# Fieldnotes product rules — v1

These are the intended behavior, given to investigators without fixture-fault information.

1. Owners may manage document access.
2. Authorized editors may read, edit and export a document.
3. Viewers may read/export but may not edit or manage access.
4. After an owner removes a user's access, all **new** protected reads and exports must be denied with HTTP 403 and must not include document content.
5. Rule 4 also applies to requests from a browser tab opened before revocation. Content already rendered while authorized is not proof of a new disclosure.
6. Saves carry an expected revision. A stale save must return HTTP 409 instead of silently overwriting a newer revision.

All documents and accounts are synthetic. No user sentiment, conversion estimates or business outcomes are inferred from these tests.
