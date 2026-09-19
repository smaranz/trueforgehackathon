# Cross-account revocation procedure

Reusable application procedure. Not registered as a TrueForge skill in this MVP.

- Establish two independent authenticated contexts and confirm the second account starts without access.
- Have the owner grant access; require an observable, committed permission change.
- Have the recipient load the protected resource while authorized.
- Keep that context open. Have the owner revoke access; observe acknowledgement and committed ACL removal.
- After that barrier, have the recipient issue a fresh export request. Inspect the response body and status, not cached DOM text.
- Attach server request ID, revision, timing, cache policy, response body and screenshot references.
- Classify unexpected/missing evidence as inconclusive. Do not repeat an uncertain write without inspecting current state.
- Reproduce a suspected disclosure with a clean seed and fresh contexts.
- Generate a regression whose passing condition is denial without protected content. Keep the assertion unchanged when testing the correction.
