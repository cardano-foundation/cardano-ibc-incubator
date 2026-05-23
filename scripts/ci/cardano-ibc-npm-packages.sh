#!/usr/bin/env bash
set -euo pipefail

mode="${1:-pack}"

package_dirs=(
  "packages/cardano-ibc-planner"
  "packages/cardano-ibc-tx-builder"
  "packages/cardano-ibc-trace-registry"
  "packages/cardano-ibc-tx-builder-runtime"
)

backup_dir=""

if [[ "${mode}" != "pack" && "${mode}" != "publish" ]]; then
  echo "Usage: $0 [pack|publish]" >&2
  exit 2
fi

package_json_field() {
  local package_dir="$1"
  local expression="$2"
  node -e "
    const fs = require('node:fs');
    const pkg = JSON.parse(fs.readFileSync('${package_dir}/package.json', 'utf8'));
    const value = ${expression};
    if (value === undefined || value === null) process.exit(1);
    process.stdout.write(String(value));
  "
}

package_name() {
  package_json_field "$1" "pkg.name"
}

package_version() {
  package_json_field "$1" "pkg.version"
}

tag_release_version() {
  if [[ "${GITHUB_REF_TYPE:-}" != "tag" ]]; then
    return 1
  fi

  if [[ ! "${GITHUB_REF_NAME:-}" =~ ^npm/cardano-ibc/v([0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z][0-9A-Za-z.-]*)?)$ ]]; then
    echo "npm package release tags must use format npm/cardano-ibc/vX.Y.Z, for example npm/cardano-ibc/v0.1.0 or npm/cardano-ibc/v0.1.0-rc.1." >&2
    exit 1
  fi

  echo "${BASH_REMATCH[1]}"
}

validate_package_metadata() {
  local release_version="${1:-}"

  for package_dir in "${package_dirs[@]}"; do
    node - "${package_dir}" "${release_version}" <<'NODE'
const fs = require('node:fs');
const [packageDir, releaseVersion] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(`${packageDir}/package.json`, 'utf8'));
const failures = [];

if (pkg.private === true) failures.push('must not be private');
if (pkg.publishConfig?.access !== 'public') failures.push('must set publishConfig.access to public');
if (!pkg.main) failures.push('must declare main');
if (!pkg.types) failures.push('must declare types');
if (!pkg.files?.includes('dist')) failures.push('must publish dist files');
if (releaseVersion && pkg.version !== releaseVersion) {
  failures.push(`version ${pkg.version} does not match release tag ${releaseVersion}`);
}

for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
  if (name.startsWith('@cardano-ibc/') && String(spec).startsWith('file:')) {
    failures.push(`dependency ${name} still uses local file spec ${spec}`);
  }
}

if (failures.length > 0) {
  console.error(`${packageDir}/package.json is not publish-ready:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
NODE
  done
}

build_and_test_packages() {
  for package_dir in "${package_dirs[@]}"; do
    echo "Installing ${package_dir}"
    npm ci --prefix "${package_dir}" --legacy-peer-deps

    echo "Building ${package_dir}"
    npm run --prefix "${package_dir}" build

    echo "Testing ${package_dir}"
    npm test --prefix "${package_dir}"
  done
}

prepare_publish_manifests() {
  backup_dir="$(mktemp -d)"

  restore_package_manifests() {
    for package_dir in "${package_dirs[@]}"; do
      local backup_file="${backup_dir}/${package_dir//\//__}.package.json"
      if [[ -f "${backup_file}" ]]; then
        cp "${backup_file}" "${package_dir}/package.json"
      fi
    done
    rm -rf "${backup_dir}"
  }
  trap restore_package_manifests EXIT

  for package_dir in "${package_dirs[@]}"; do
    cp "${package_dir}/package.json" "${backup_dir}/${package_dir//\//__}.package.json"
  done

  node - "${package_dirs[@]}" <<'NODE'
const fs = require('node:fs');
const packageDirs = process.argv.slice(2);
const versions = new Map();

for (const packageDir of packageDirs) {
  const pkg = JSON.parse(fs.readFileSync(`${packageDir}/package.json`, 'utf8'));
  versions.set(pkg.name, pkg.version);
}

for (const packageDir of packageDirs) {
  const packagePath = `${packageDir}/package.json`;
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  for (const section of ['dependencies', 'peerDependencies']) {
    if (!pkg[section]) continue;

    for (const [name, version] of versions) {
      if (!(name in pkg[section])) continue;
      pkg[section][name] = version;
    }
  }

  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}
NODE
}

pack_packages() {
  for package_dir in "${package_dirs[@]}"; do
    echo "Dry-run packing $(package_name "${package_dir}")@$(package_version "${package_dir}")"
    (cd "${package_dir}" && npm pack --dry-run)
  done
}

publish_packages() {
  for package_dir in "${package_dirs[@]}"; do
    local name version
    name="$(package_name "${package_dir}")"
    version="$(package_version "${package_dir}")"

    if npm view "${name}@${version}" version --registry=https://registry.npmjs.org >/dev/null 2>&1; then
      echo "${name}@${version} already exists on npm; skipping."
      continue
    fi

    echo "Publishing ${name}@${version}"
    (cd "${package_dir}" && npm publish --access public --provenance)
  done
}

release_version=""
if [[ "${GITHUB_REF_TYPE:-}" == "tag" ]]; then
  release_version="$(tag_release_version)"
fi

build_and_test_packages
prepare_publish_manifests
validate_package_metadata "${release_version}"
pack_packages

if [[ "${mode}" == "publish" ]]; then
  if [[ -z "${release_version}" ]]; then
    echo "Publishing is only allowed from npm package release tags." >&2
    exit 1
  fi

  publish_packages
fi
