# Contributing to this project

First off, thanks for taking the time to contribute! 🎉

When contributing to this repository, please first describe the change you wish to make [via an issue](../../issues/new) before making a change. For every other form of discussion use the [discussions section](../../discussions) of this repo.
Please note we have a [code of conduct](CODE_OF_CONDUCT.md), please follow it in all your interactions with the project.

## Issues and pull requests

### Bug reports

[Submit an issue](../../issues/new) using the provided template for bug reports. If the template does not fit your purpose start with a blank issue.

For bug reports, it's very important to fill in the information in the structure provided by the templates to help us analyzing the bug.

### Feature requests and ideas

[Submit an issue](../../issues/new) using the provided template for feature requests. If the template does not fit your purpose start with a blank issue but make sure the name starts with a "FEATURE" in square brackets.

If you are starting with a very vague idea instead of a concrete feature request post it in the [discussions section](../../discussions) of the repository where we can refine the idea with you and create a structured feature request from it.

### Creating a pull request

Thank you for contributing your changes by opening a pull requests! To get something merged we usually require:

- ❗ Description of the changes - please follow the [Conventional Commits specification](https://www.conventionalcommits.org/en/v1.0.0/#specification) as we use it to automatically generate our CHANGELOG ❗
- Quality of changes is ensured - through new or updated automated tests
- Change is related to an issue (feature request or bug report) - ideally discussed beforehand
- Well-scoped - we prefer multiple PRs, rather than a big one

The image publishing workflow checks the baseline action at the exact revision in
`build-image.yaml`. It rejects undeclared inputs and outputs. It then runs the
action's metadata step for each component with normal and prerelease tags and
passes those outputs to the release publisher with Docker calls held in memory.
This check runs before image builds on PRs and release tags. Every real image
build also checks the discovered version against its component manifest.

To run these checks locally, use Python 3.11 or newer with `PyYAML==6.0.2`,
Node.js 22 or newer and `jq`. Initialize the relayer submodule so its
`Cargo.toml` is available, then run from the repository root:

```sh
git submodule update --init relayer
python3 scripts/ci/image-metadata.test.py
python3 scripts/ci/image-metadata.py
```

The rehearsal downloads the pinned action metadata. It runs that action's Bash
metadata step in temporary Git repositories without CI credentials. It does not
run the action's setup or login steps and does not contact a registry.
