# Partner binary-upgrade project field

In [Cardano Foundation project 32](https://github.com/orgs/cardano-foundation/projects/32),
`Partner binary upgrade` is derived from the linked issue or PR:

| Label | Project value |
| --- | --- |
| `partner-binary-upgrade` present | Required |
| Label absent | Not required |

Draft items have no labels and map to Not required. Closed and archived items use
the same rule. A missing or inaccessible issue is an error, not evidence that its
label is absent. Update the issue/PR label to change the classification.

The Partner upgrades view filters `label:partner-binary-upgrade` directly.
Release inclusion, target binaries, deployment dates, and rollout progress belong
in the rollout issue and Plan note, independently of this classification.

## Enable synchronization

1. Configure the Actions secret `PROJECT_SYNC_TOKEN` with an approved credential
   that can read the project's linked issues/PRs and read/write **organization
   Projects** for `cardano-foundation`. Restrict repository access to the linked
   repositories and do not grant repository write permissions just for this job.
   GitHub may require organization approval for a fine-grained personal access
   token. An organization-approved GitHub App installation token can also be used
   by replacing the authentication step with token generation for that app.
2. Merge `.github/workflows/partner-binary-upgrade.yml` and its script onto `main`.
3. Run **Sync partner binary upgrade** manually and verify that its final output
   reports `"drift":0`.

The standard workflow `GITHUB_TOKEN` cannot access organization Projects. See
[GitHub's Projects automation authentication requirements](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions).
Do not copy a developer's CLI credential into Actions as a shortcut.

The workflow reacts to relevant issue/PR label changes and label renames/deletion.
Every run reads current labels rather than trusting the event's previous state.
Runs are serialized and reconcile the entire project, so a replaced pending run
cannot lose an unrelated item's label change. A scheduled reconciliation every
five minutes also covers items added directly to the project and manual edits.
GitHub can delay scheduled jobs; the separate custom field is eventually
consistent, while the native Labels field and label-filtered view reflect GitHub's
source data directly. GitHub provides no computed or read-only constraint for
this custom single-select field.

The privileged job checks out only the default branch and never executes fork PR
code. Its project credential is supplied only to the reconciliation step. Tests
on PR code run separately without that credential.

## Verify or reconcile locally

Using `gh` authenticated with project access:

```sh
node --test scripts/ci/sync-partner-binary-upgrade.test.mjs
node scripts/ci/sync-partner-binary-upgrade.mjs --check
node scripts/ci/sync-partner-binary-upgrade.mjs --apply
```

With no flag the script prints the proposed changes without writing. `--check`
exits unsuccessfully when values disagree. `--apply` writes only the derived
field, leaves issue labels and other project fields intact, and re-reads the
project to verify convergence.
