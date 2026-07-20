# Design Notes

## Part 3b — Activity feed: should a failed activity write roll back the original change?

**Decision: No — the activity write is best-effort and non-blocking.** Each
mutation (task created, status changed, assignee changed, comment added)
commits on its own; the activity record is written immediately after in a
`try/catch` that logs failures server-side but never propagates them to the
caller.

**Reasoning.** The activity feed is a secondary, read-only projection for
humans — its job is to *describe* what happened, not to *authorize* it. The
user's primary action, and that action's own consistency, must not hinge on an
auxiliary audit insert; failing a card move because the feed row couldn't be
written would be a strictly worse product outcome than a momentarily
incomplete feed. Since the activity insert is a trivial same-database write,
its realistic failure mode is the DB itself being down — in which case the
primary mutation already failed, so wrapping both in a transaction would buy
almost no real consistency while coupling every core write to the feed. We
therefore keep the feed off the hot path and log any audit-write failure for
later reconciliation. (Contrast Part 3a comments: a comment *is* the record of
truth, written as a single atomic insert — the activity row that mirrors it
into the feed is the best-effort part.)
