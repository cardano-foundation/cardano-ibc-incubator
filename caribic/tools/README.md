# Caribic provisioning tools

Standalone Deno scripts that prepare the funded accounts needed for public-network
runs (see "Full Test: Cardano Preprod to Injective Testnet" in `../README.md`).
Deno is already a project prerequisite; the scripts have no other requirements.

## provision-preprod-deployer.ts

Generates (or reuses) the preprod deployer key at `~/.caribic/preprod-deployer.sk`
in the `ed25519_sk1...` format `DEPLOYER_SK` expects, derives the preprod address,
requests faucet funds, and waits until the address is funded.

```bash
deno run --allow-net --allow-read --allow-write --allow-env caribic/tools/provision-preprod-deployer.ts
```

- With `CARDANO_FAUCET_API_KEY` set, the script calls the preprod faucet API directly.
  Without it, it prints the address and web-faucet instructions and polls Koios until
  the funds arrive.
- `--no-wait` skips the balance polling.
- Re-running is safe: an existing key is reused, and an already-funded address skips
  the faucet step.

## provision-injective-testnet-key.ts

Generates (or reuses) a mnemonic at `~/.caribic/injective-testnet.mnemonic` using the
Ethermint HD path `m/44'/60'/0'/0/0` (the path Hermes uses for Injective), derives the
`inj...` address, prints faucet instructions (the Injective testnet faucet is
captcha-protected, so funding is manual), and polls the testnet LCD until the address
holds INJ. It finishes by printing the exact `caribic keys add` command.

```bash
deno run --allow-net --allow-read --allow-write --allow-env caribic/tools/provision-injective-testnet-key.ts
```

Both scripts write key material with `0600` permissions. Treat the generated files as
secrets — they control real (test) funds.
