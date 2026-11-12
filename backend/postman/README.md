# Postman

Two files:

- `Foundry.postman_collection.json` — 50 requests covering every endpoint
- `Foundry.postman_environment.json` — the variables they need

## Running it

1. Postman → **Import** → both files.
2. Top-right environment dropdown → **Foundry - deployed**.
   Without this every URL reads `{{baseUrl}}` literally.
3. Hover the collection → **Run** → **Run Foundry**.

**Run it in order.** Requests save `token`, `itemId`, `claimId`, `handoverCode`
and the rest into variables as they succeed; anything that needs a token will
fail if it runs first.

## Accounts it needs

Three accounts must already exist in the target database:

| Variable | Role | Why |
|---|---|---|
| `studentEmail` / `studentPassword` | student | posts the listing and owns it |
| `otherEmail` / `otherPassword` | student | claims the listing — the same account cannot claim its own |
| `adminEmail` / `adminPassword` | admin or superadmin | the admin requests |

Fill these in the environment before the first run.

## The one case that cannot pass

*Report a listing twice* expects 201, not 409. `reports` has no unique
`(item, reported_by)` index, so a second report is accepted. Adding
`CREATE UNIQUE INDEX reports_item_reporter_uniq ON reports (item, reported_by)`
would make the 409 real; until then the request documents the current behaviour
honestly rather than asserting something untrue.
