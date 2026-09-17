#!/usr/bin/env python3
"""Build the real v8-classic counterparty with a disposable producer clock.

No verifier or consensus-validation rule is patched. This image exists solely
to rehearse the unchanged 24-hour on-chain approval delay without host-clock
changes. Never use it for a public network or production deployment.
"""
import argparse
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', default='cardano-ibc-migration-cosmos-clock')
    args = parser.parse_args()
    dockerfile = (ROOT / 'chains/cosmos/Dockerfile').read_text()
    anchor = 'RUN --mount=type=cache,target=/root/.cache/go-build'
    if dockerfile.count(anchor) != 1:
        raise RuntimeError('Counterparty build changed; review clock fixture integration')
    clock_source = (ROOT / 'scripts/ci/cosmos-migration-clock.go.fixture').read_text()
    patch = "COPY <<'MIGRATION_CLOCK_SOURCE' /tmp/migration_clock.go\n" + clock_source + "\nMIGRATION_CLOCK_SOURCE\n" + '''RUN cd /src/ibc-go \\
    && clock_module_dir="$(go list -m -f '{{.Dir}}' github.com/cometbft/cometbft)" \\
    && cp -a "$clock_module_dir" /src/migration-cometbft \\
    && chmod -R u+w /src/migration-cometbft \\
    && test "$(grep -c 'return Canonical(time.Now())' /src/migration-cometbft/types/time/time.go)" = 1 \\
    && sed -i 's/return Canonical(time.Now())/return Canonical(migrationClockNow())/' /src/migration-cometbft/types/time/time.go \\
    && cp /tmp/migration_clock.go /src/migration-cometbft/types/time/migration_clock.go \\
    && go mod edit -replace github.com/cometbft/cometbft=/src/migration-cometbft

'''
    # Linking the full supported simapp uses substantial temporary space. Keep
    # that disposable linker workspace out of Docker's persistent image disk.
    dockerfile = dockerfile.replace(anchor, patch + anchor + ' \\\n    --mount=type=tmpfs,target=/tmp')
    dockerfile += '\nLABEL org.cardano-ibc.disposable-migration-clock="true"\n'
    with tempfile.NamedTemporaryFile('w', suffix='.Dockerfile') as generated:
        generated.write(dockerfile); generated.flush()
        subprocess.run(['docker', 'build', '-t', args.tag, '-f', generated.name,
            '--build-arg', 'GO_IMAGE=golang:1.21-alpine3.18', '--build-arg', 'PROFILE=v8-classic',
            '--build-arg', 'IBC_GO_MAJOR=8', '--build-arg', 'IBC_GO_VERSION=8.7.0',
            '--build-arg', 'IBC_GO_REF=v8.7.0', '--build-arg', 'IBC_GO_COMMIT=53eaba19375dab0145509af101dbce193284ec5d',
            '--build-arg', 'IBC_SEMANTICS=classic', str(ROOT)], check=True)

if __name__ == '__main__':
    main()
