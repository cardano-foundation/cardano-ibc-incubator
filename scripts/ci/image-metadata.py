#!/usr/bin/env python3
"""Prepare image metadata and rehearse the pinned action's releases without Docker."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import tomllib
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?")
EXPRESSION = re.compile(r"\$\{\{\s*(.*?)\s*\}\}")
REGISTRIES = "ghcr.io/example registry.example.test/team"
IMAGE_ID = "sha256:" + "ab" * 32


def component_version(directory):
    directory = Path(directory)
    if (directory / "package.json").is_file():
        version = json.loads((directory / "package.json").read_text()).get("version")
    elif (directory / "Cargo.toml").is_file():
        version = tomllib.loads((directory / "Cargo.toml").read_text()).get("package", {}).get("version")
    else:
        raise ValueError(f"No package.json or Cargo.toml version source in {directory}")
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise ValueError(f"Missing or invalid component version in {directory}: {version!r}")
    return version


def check_component_version(component, directory, discovered, ref_type="branch", ref_name=""):
    version = component_version(directory)
    if discovered != version:
        raise ValueError(
            f"{component}: action discovered version {discovered!r}, "
            f"but {directory} declares {version!r}"
        )
    if ref_type == "tag" and ref_name != f"{component}/v{version}":
        raise ValueError(f"Release tag {ref_name!r} does not match {component}/v{version}")
    return version


def normalize_image_tags(component, image_tag, extra_tags, ref_type):
    def normalize(tag):
        # Git tags select a component. Docker tags cannot include that prefix.
        return tag.removeprefix(f"{component}/") if ref_type == "tag" else tag

    return {
        "IMAGE_TAG": normalize(image_tag),
        "EXTRA_TAGS": " ".join(normalize(tag) for tag in extra_tags.split()),
    }


def render(value, context):
    def replace(match):
        key = match[1]
        if key not in context:
            raise ValueError(f"Unsupported metadata expression: {key}")
        return str(context[key])

    return EXPRESSION.sub(replace, str(value))


def load_yaml(text):
    # Actual image builds only use the standard-library version check above.
    import yaml

    return yaml.safe_load(text)


def fetch_action(uses):
    match = re.fullmatch(r"([\w.-]+)/([\w.-]+)/(.+)@([0-9a-f]{40})", uses)
    if not match:
        raise ValueError("The baseline action must reference a full commit SHA")
    owner, repository, path, sha = match.groups()
    path = "/".join(part for part in path.split("/") if part != ".")
    for filename in ("action.yaml", "action.yml"):
        url = f"https://raw.githubusercontent.com/{owner}/{repository}/{sha}/{path}/{filename}"
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                return load_yaml(response.read().decode())
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
    raise ValueError(f"No action metadata found for {uses}")


def validate_interface(action, baseline, workflow_text):
    declared = action.get("inputs", {})
    supplied = baseline.get("with", {})
    unknown = set(supplied) - set(declared)
    missing = {
        name for name, definition in declared.items()
        if definition.get("required") and "default" not in definition and name not in supplied
    }
    outputs = set(re.findall(r"steps\.baseline\.outputs\.([\w-]+)", workflow_text))
    unknown_outputs = outputs - set(action.get("outputs", {}))
    problems = []
    if unknown:
        problems.append("undeclared inputs: " + ", ".join(sorted(unknown)))
    if missing:
        problems.append("missing required inputs: " + ", ".join(sorted(missing)))
    if unknown_outputs:
        problems.append("undeclared outputs: " + ", ".join(sorted(unknown_outputs)))
    if problems:
        raise ValueError(f"{baseline['uses']}: " + ". ".join(problems))


def run(command, directory, env=None, stdin=None):
    result = subprocess.run(
        command, cwd=directory, env=env, input=stdin,
        text=True, capture_output=True, timeout=30,
    )
    if result.returncode:
        raise ValueError(f"{' '.join(command[:2])} failed:\n{result.stdout}{result.stderr}")
    return result.stdout


def read_outputs(path):
    return dict(line.split("=", 1) for line in path.read_text().splitlines() if "=" in line)


def write_outputs(values):
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        for name, value in values.items():
            output.write(f"{name}={value}\n")


def fixture_env(directory, **values):
    # Do not inherit CI tokens, action outputs or the runner's GitHub context.
    return {
        "PATH": os.environ["PATH"],
        "GITHUB_ENV": str(directory / "env"),
        "GITHUB_OUTPUT": str(directory / "output"),
        "GITHUB_RUN_ID": "123",
        **values,
    }


def select_components(publish):
    step = next(
        step for step in publish["jobs"]["select-components"]["steps"]
        if step.get("id") == "select"
    )
    with tempfile.TemporaryDirectory(prefix="image-components-") as temporary:
        directory = Path(temporary)
        env = fixture_env(directory, REF_TYPE="branch", GITHUB_EVENT_NAME="push")
        run(["bash", "-eo", "pipefail", "-c", step["run"]], directory, env)
        images = json.loads(read_outputs(directory / "output")["images"])
    if not images or {image["component"] for image in images} != {"gateway", "hermes", "swap-client"}:
        raise ValueError("Expected the publishing workflow to select all three image components")
    return images


def workflow_metadata_step(steps, step_id, context, directory, env):
    step = next((step for step in steps if step.get("id") == step_id), None)
    if step is None:
        return
    if step.get("shell") != "bash" or "run" not in step or step.get("if"):
        raise ValueError(f"Expected an unconditional Bash workflow step: {step_id}")
    output = directory / f"{step_id}-output"
    step_env = {
        **env,
        **{name: render(value, context) for name, value in step.get("env", {}).items()},
        "GITHUB_OUTPUT": str(output),
    }
    run(["bash", "-eo", "pipefail", "-c", render(step["run"], context)], directory, step_env)
    context.update({f"steps.{step_id}.outputs.{name}": value for name, value in read_outputs(output).items()})


def action_metadata(action, baseline, image, directory, env, workflow_context=None):
    context = {
        **(workflow_context or {}),
        "inputs.component": image["component"],
        "inputs.version-directory": image["version_directory"],
        "github.token": "",
        "steps.registries.outputs.registries": REGISTRIES,
    }
    for name in baseline.get("with", {}):
        for expression in EXPRESSION.findall(str(baseline["with"][name])):
            if expression.startswith("secrets."):
                context[expression] = ""
    inputs = {name: definition.get("default", "") for name, definition in action.get("inputs", {}).items()}
    inputs.update({name: render(value, context) for name, value in baseline.get("with", {}).items()})
    context.update({f"inputs.{name}": value for name, value in inputs.items()})
    # These expressions occur in the unexecuted PR arm of the metadata script.
    context.update({
        "github.event.pull_request.head.repo.full_name": "example/repository",
        "github.event.pull_request.head.ref": "metadata-check",
        "github.repository": "example/repository",
        "github.event.pull_request.base.ref": "main",
        "github.event.pull_request.number": "1",
        "github.event.pull_request.head.sha": env["GITHUB_SHA"],
    })
    step = next(step for step in action["runs"]["steps"] if step.get("id") == "metadata")
    if step.get("shell") != "bash" or "run" not in step or step.get("if"):
        raise ValueError("Expected an unconditional Bash metadata step in the pinned baseline action")
    step_env = {**env, **{name: render(value, context) for name, value in baseline.get("env", {}).items()}}
    run(["bash", "-eo", "pipefail", "-c", render(step["run"], context)], directory, step_env)
    outputs = read_outputs(directory / "output")
    context.update({f"steps.metadata.outputs.{name}": value for name, value in outputs.items()})
    # GitHub resolves an unwritten step output to the empty string.
    for definition in action["outputs"].values():
        for expression in EXPRESSION.findall(definition["value"]):
            context.setdefault(expression, "")
    return {name: render(definition["value"], context) for name, definition in action["outputs"].items()}


def rehearse(action, baseline, build_steps, image, version, root=ROOT):
    component = image["component"]
    with tempfile.TemporaryDirectory(prefix=f"image-metadata-{component}-") as temporary:
        directory = Path(temporary)
        relative = Path(image["version_directory"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Component version directories must stay inside the checkout")
        target = directory / relative
        target.mkdir(parents=True)
        # Copy the actual manifest and vary only its version for prerelease coverage.
        if (root / relative / "package.json").is_file():
            manifest = json.loads((root / relative / "package.json").read_text())
            manifest["version"] = version
            (target / "package.json").write_text(json.dumps(manifest))
        else:
            manifest = (root / relative / "Cargo.toml").read_text()
            package = tomllib.loads(manifest)["package"]
            manifest = manifest.replace(f'"{package["version"]}"', f'"{version}"', 1)
            (target / "Cargo.toml").write_text(manifest)
        run(["git", "init", "-q"], directory)
        run(["git", "add", "."], directory)
        run(["git", "-c", "user.name=Metadata check", "-c", "user.email=ci@example.test",
             "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null",
             "commit", "-q", "-m", "metadata fixture"], directory)
        sha = run(["git", "rev-parse", "HEAD"], directory).strip()
        run(["git", "-c", "tag.gpgsign=false", "tag", f"{component}/v{version}"], directory)
        env = fixture_env(directory, GITHUB_WORKSPACE=str(ROOT), GITHUB_SHA=sha,
                          GITHUB_EVENT_NAME="push", GITHUB_REF_TYPE="tag",
                          GITHUB_REF_NAME=f"{component}/v{version}",
                          GITHUB_REF=f"refs/tags/{component}/v{version}")
        context = {
            "inputs.component": component,
            "inputs.version-directory": image["version_directory"],
        }
        workflow_metadata_step(build_steps, "version", context, directory, env)
        outputs = action_metadata(action, baseline, image, directory, env, context)
        check_component_version(component, target, outputs["GUESSED_ARTIFACT_VERSION"],
                                env["GITHUB_REF_TYPE"], env["GITHUB_REF_NAME"])
        context.update({
            "steps.image.outputs.id": IMAGE_ID,
            **{f"steps.baseline.outputs.{name}": value for name, value in outputs.items()},
        })
        workflow_metadata_step(build_steps, "image_tags", context, directory, env)
        # Resolve the actual release consumer's wiring, rather than constructing
        # known-good IMAGE_TAG or EXTRA_TAGS values in the test.
        def consumer_env(step_name):
            step = next(step for step in build_steps if step.get("name") == step_name)
            return {**env, **{name: render(value, context) for name, value in step["env"].items()}}

        result = run(["node", str(ROOT / "scripts/ci/image-release-rehearsal.mjs")], ROOT,
                     stdin=json.dumps({"env": consumer_env("Publish tested image"),
                                       "preflightEnv": consumer_env("Require unused release image tags"),
                                       "version": version,
                                       "commit": sha[:7], "registries": REGISTRIES.split()}))
        print(result.strip())


def check_metadata(build_path, publish_path, root=ROOT):
    workflow_text = build_path.read_text()
    build = load_yaml(workflow_text)
    steps = build["jobs"]["build"]["steps"]
    baseline = next(step for step in steps if step.get("id") == "baseline")
    action = fetch_action(baseline["uses"])
    validate_interface(action, baseline, workflow_text)
    print(f"Action inputs and outputs match {baseline['uses']}", flush=True)
    for image in select_components(load_yaml(publish_path.read_text())):
        version = component_version(root / image["version_directory"])
        versions = dict.fromkeys([version, version.split("-")[0] + "-rc.1"])
        for candidate in versions:
            try:
                rehearse(action, baseline, steps, image, candidate, root)
            except (ValueError, KeyError, StopIteration) as error:
                raise ValueError(f"{image['component']}/v{candidate}: {error}") from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--read-version", action="store_true", help="Export the declared component version to GITHUB_OUTPUT")
    modes.add_argument("--normalize-tags", action="store_true", help="Remove component prefixes from Docker release tags")
    modes.add_argument("--check-version", action="store_true", help="Check real build outputs against the component manifest")
    parser.add_argument("--build-workflow", type=Path, default=ROOT / ".github/workflows/build-image.yaml")
    parser.add_argument("--publish-workflow", type=Path, default=ROOT / ".github/workflows/publish.yaml")
    args = parser.parse_args()
    if args.read_version:
        write_outputs({"version": component_version(os.environ["VERSION_DIRECTORY"])})
    elif args.normalize_tags:
        write_outputs(normalize_image_tags(
            os.environ["COMPONENT"], os.environ["IMAGE_TAG"], os.environ.get("EXTRA_TAGS", ""),
            os.environ.get("GITHUB_REF_TYPE", "branch"),
        ))
    elif args.check_version:
        component = os.environ["COMPONENT"]
        version = check_component_version(
            component, os.environ["VERSION_DIRECTORY"], os.environ.get("COMPONENT_VERSION", ""),
            os.environ.get("GITHUB_REF_TYPE", "branch"), os.environ.get("GITHUB_REF_NAME", ""),
        )
        print(f"{component}: action version matches manifest version {version}")
    else:
        check_metadata(args.build_workflow, args.publish_workflow)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, StopIteration, OSError, subprocess.SubprocessError) as error:
        raise SystemExit(f"Image metadata check failed: {error}") from error
