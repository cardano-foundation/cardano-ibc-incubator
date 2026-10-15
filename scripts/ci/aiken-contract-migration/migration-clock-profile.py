#!/usr/bin/env python3
"""Clock profile for the owned rehearsal's actual probabilistic counterparty.

The verifier requires six calendar months of registration age at its anchor.
A backdated genesis alone does not qualify fresh pools. The owned fixture must
produce real history while its clocks advance before any IBC client is created.
Twenty million one-second slots leave a margin beyond six calendar months.
"""
import datetime
from fractions import Fraction
import time

UTC = datetime.timezone.utc
REHEARSAL_START = datetime.datetime(2025, 12, 29, tzinfo=UTC)
POOL_AGING_SECONDS = 20_000_000


def proof_readiness_timeout(genesis):
    # Twenty-four blocks at the selected mainnet interval can take longer
    # than ten minutes. This changes only the harness wait, never proof rules.
    return 1800 if (genesis.get('securityParam') == 2160 and
                    Fraction(str(genesis.get('activeSlotsCoeff', 0))) == Fraction(1, 20)) else 600


def initial_offset(now=None):
    return int(REHEARSAL_START.timestamp()) - int(time.time() if now is None else now)


def require_aging_headroom(genesis, now=None):
    if genesis.get('slotLength') != 1:
        raise ValueError('Migration rehearsal requires one-second Cardano slots')
    start = datetime.datetime.fromisoformat(genesis['systemStart'].replace('Z', '+00:00'))
    if start.tzinfo is None:
        raise ValueError('Migration rehearsal genesis systemStart must include its UTC offset')
    current = time.time() if now is None else now
    if start.timestamp() + POOL_AGING_SECONDS + 259200 > current:
        raise ValueError(
            'Genesis leaves insufficient clock headroom for real pool aging and the rehearsal. '
            'Create a fresh owned rehearsal with --clock-offset-seconds "$(python3 '
            'scripts/ci/aiken-contract-migration/migration-clock-profile.py)"; preserve verifier rules and registration evidence.'
        )


if __name__ == '__main__':
    print(initial_offset())
