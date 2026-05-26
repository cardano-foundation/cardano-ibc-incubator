# Validator Protocol Explorer

This is a static interactive model of the Cardano IBC on-chain protocol. It is
designed to make validator mechanics easier to inspect than a flat diagram:

- choose an IBC operation;
- inspect the transaction inputs, reference inputs, mints, outputs, and
  validators;
- follow operation-specific lifecycle transitions;
- review HostState commitment keys and invariant checks.

The model lives in [`protocol-model.js`](protocol-model.js). The UI in
[`app.js`](app.js) is generated from that data, so future operations should be
added to the model first.

## Run Locally

From this directory:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

The explorer has no build step and no external dependencies. That keeps it easy
to publish from GitHub Pages later.
