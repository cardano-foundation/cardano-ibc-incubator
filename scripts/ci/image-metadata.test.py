import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("image_metadata", Path(__file__).with_name("image-metadata.py"))
metadata = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metadata)


class ImageMetadataTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="image-metadata-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.directory = self.root / "component"
        self.directory.mkdir()
        (self.directory / "package.json").write_text('{"version":"2.0.2"}')

    def test_reads_json_and_rust_package_versions(self):
        self.assertEqual(metadata.component_version(self.directory), "2.0.2")
        (self.directory / "package.json").unlink()
        (self.directory / "Cargo.toml").write_text(
            '[workspace.package]\nversion = "9.9.9"\n'
            '[package]\nname = "hermes"\nversion = "1.13.2" # release\n'
            '[dependencies]\nother = { version = "0.0.1" }\n'
        )
        self.assertEqual(metadata.component_version(self.directory), "1.13.2")

    def test_missing_and_invalid_version_sources_fail(self):
        for version in (None, "", "v2.0.2", "2.0", {"workspace": True}):
            with self.subTest(version=version):
                (self.directory / "package.json").write_text(json.dumps({"version": version}))
                with self.assertRaisesRegex(ValueError, "Missing or invalid"):
                    metadata.component_version(self.directory)
        (self.directory / "package.json").unlink()
        with self.assertRaisesRegex(ValueError, "No package.json or Cargo.toml"):
            metadata.component_version(self.directory)

    def test_every_build_checks_the_actual_manifest_including_fallback_versions(self):
        self.assertEqual(metadata.check_component_version("gateway", self.directory, "2.0.2"), "2.0.2")
        for version in ("0.0.1", "", "2.0.1"):
            with self.subTest(version=version), self.assertRaisesRegex(ValueError, "action discovered"):
                metadata.check_component_version("gateway", self.directory, version)
        (self.directory / "package.json").write_text('{"version":"0.0.1"}')
        self.assertEqual(metadata.check_component_version("gateway", self.directory, "0.0.1"), "0.0.1")

    def test_release_tag_must_match_the_manifest(self):
        metadata.check_component_version("gateway", self.directory, "2.0.2", "tag", "gateway/v2.0.2")
        with self.assertRaisesRegex(ValueError, "does not match"):
            metadata.check_component_version("gateway", self.directory, "2.0.2", "tag", "gateway/v2.0.3")

    def test_interface_checks_the_supplied_inputs_and_consumed_outputs(self):
        baseline = {"uses": "example/action/path@" + "a" * 40, "with": {"artifact-version-directory": "component"}}
        action = {"inputs": {"artifact-version-directory": {}}, "outputs": {"DOCKER_TAG": {}}}
        consumer = "${{ steps.baseline.outputs.DOCKER_TAG }}"
        metadata.validate_interface(action, baseline, consumer)
        with self.assertRaisesRegex(ValueError, "undeclared inputs: artifact-version-directory"):
            metadata.validate_interface({**action, "inputs": {}}, baseline, consumer)
        with self.assertRaisesRegex(ValueError, "undeclared outputs: DOCKER_TAG"):
            metadata.validate_interface({**action, "outputs": {}}, baseline, consumer)
        action["inputs"]["required"] = {"required": True}
        with self.assertRaisesRegex(ValueError, "missing required inputs: required"):
            metadata.validate_interface(action, baseline, consumer)

    def test_fetch_uses_the_workflow_sha_and_fails_on_network_errors(self):
        uses = "owner/repository/./actions/baseline@" + "a" * 40
        with patch.object(metadata.urllib.request, "urlopen", side_effect=OSError("offline")) as fetch:
            with self.assertRaisesRegex(OSError, "offline"):
                metadata.fetch_action(uses)
            self.assertEqual(fetch.call_args.args[0],
                             "https://raw.githubusercontent.com/owner/repository/" + "a" * 40 +
                             "/actions/baseline/action.yaml")
        with self.assertRaisesRegex(ValueError, "full commit SHA"):
            metadata.fetch_action("owner/repository/actions/baseline@main")

    def test_unknown_context_expressions_fail_instead_of_silently_becoming_empty(self):
        with self.assertRaisesRegex(ValueError, "Unsupported metadata expression"):
            metadata.render("${{ inputs.renamed }}", {})

    def rehearsal_fixture(self):
        script = """
version=$(jq -r '.version' '${{ inputs.artifact-version-directory }}/package.json')
tag=${GITHUB_REF_NAME##*/}
commit=$(git rev-parse HEAD | head -c7)
echo "VERSION=$version" >> "$GITHUB_OUTPUT"
echo "TAG=$tag" >> "$GITHUB_OUTPUT"
echo "EXTRA=$tag-$commit $tag-$commit-GHRUN$GITHUB_RUN_ID $tag" >> "$GITHUB_OUTPUT"
echo 'REGISTRIES=${{ inputs.DOCKER_REGISTRIES }}' >> "$GITHUB_OUTPUT"
"""
        action = {
            "inputs": {"artifact-version-directory": {}, "DOCKER_REGISTRIES": {}},
            "outputs": {
                public: {"value": "${{ steps.metadata.outputs." + internal + " }}"}
                for public, internal in [("GUESSED_ARTIFACT_VERSION", "VERSION"), ("DOCKER_TAG", "TAG"),
                                         ("EXTRA_TAGS", "EXTRA"), ("REGISTRIES", "REGISTRIES")]
            },
            "runs": {"steps": [{"id": "metadata", "shell": "bash", "run": script}]},
        }
        baseline = {"with": {
            "artifact-version-directory": "${{ inputs.version-directory }}",
            "DOCKER_REGISTRIES": "${{ steps.registries.outputs.registries }}",
        }}
        steps = [{"name": "Publish tested image", "env": {
            "COMPONENT": "${{ inputs.component }}", "IMAGE_ID": "${{ steps.image.outputs.id }}",
            "IMAGE_TAG": "${{ steps.baseline.outputs.DOCKER_TAG }}",
            "EXTRA_TAGS": "${{ steps.baseline.outputs.EXTRA_TAGS }}",
            "REGISTRIES": "${{ steps.baseline.outputs.REGISTRIES }}",
        }}]
        steps.append({"name": "Require unused release image tags", "env": {
            name: value for name, value in steps[0]["env"].items() if name != "IMAGE_ID"
        }})
        return action, baseline, steps, {"component": "gateway", "version_directory": "component"}

    def test_rehearses_emitted_release_outputs_and_prereleases_with_the_real_publisher(self):
        for version in ("2.0.2", "2.0.2-rc.1"):
            with self.subTest(version=version):
                metadata.rehearse(*self.rehearsal_fixture(), version, root=self.root)

    def test_rehearsal_rejects_wrong_version_and_component_prefixed_docker_tags(self):
        for before, after, expected in [
            ("VERSION=$version", "VERSION=0.0.1", "action discovered"),
            ("tag=${GITHUB_REF_NAME##*/}", "tag=$GITHUB_REF_NAME", "IMAGE_TAG must be a version tag"),
            ("EXTRA=$tag-$commit", "EXTRA=latest", "EXTRA_TAGS may only contain"),
        ]:
            with self.subTest(regression=expected):
                action, baseline, steps, image = self.rehearsal_fixture()
                action["runs"]["steps"][0]["run"] = action["runs"]["steps"][0]["run"].replace(before, after)
                with self.assertRaisesRegex(ValueError, expected):
                    metadata.rehearse(action, baseline, steps, image, "2.0.2", root=self.root)

    def test_rehearsal_checks_the_preflight_consumer_wiring(self):
        action, baseline, steps, image = self.rehearsal_fixture()
        steps[1]["env"]["IMAGE_TAG"] = "gateway/v2.0.2"
        with self.assertRaisesRegex(ValueError, "IMAGE_TAG must be a version tag"):
            metadata.rehearse(action, baseline, steps, image, "2.0.2", root=self.root)

    def test_workflow_requires_metadata_before_building_and_checks_versions_unconditionally(self):
        publish = metadata.load_yaml((metadata.ROOT / ".github/workflows/publish.yaml").read_text())
        self.assertIn("image-metadata", publish["jobs"]["select-components"]["needs"])
        self.assertIn("needs.image-metadata.result == 'success'", publish["jobs"]["select-components"]["if"])
        self.assertNotIn("if", publish["jobs"]["image-metadata"])
        build = metadata.load_yaml((metadata.ROOT / ".github/workflows/build-image.yaml").read_text())
        step = next(step for step in build["jobs"]["build"]["steps"] if step["name"] == "Validate component version")
        self.assertNotIn("if", step)
        self.assertEqual(step["run"], "python3 scripts/ci/image-metadata.py --check-version")


if __name__ == "__main__":
    unittest.main()
