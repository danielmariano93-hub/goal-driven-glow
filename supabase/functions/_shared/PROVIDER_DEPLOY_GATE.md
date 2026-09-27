# Nino provider deployment gate

The production deployment validates provider credentials and the required model catalog before invoking the live semantic smoke.

A transient provider HTTP 429 is treated as capacity pressure in the production deploy workflow, not as evidence that the repository revision is broken. Non-429 provider failures, missing credentials/models, invalid structured transport, and semantic contract regressions remain deployment blockers.

The standalone provider diagnostic workflow is manual and remains fail-closed so provider capacity can be investigated explicitly without competing with a production deployment for the same token-per-minute quota.
