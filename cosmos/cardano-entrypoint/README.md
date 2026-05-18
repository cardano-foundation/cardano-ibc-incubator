# Retained Historical Chain Source

This Cosmos SDK chain source is retained for historical reference and for any future extraction of useful modules or types.

It is not part of the maintained runtime path:

- It is not started by `caribic`.
- It is not a managed service.
- Product demos and route setup must not route through it.
- Production integrations should use direct Cardano-to-target-chain clients, connections, and channels.

If a future change revives this code, it needs a fresh security and operations decision that treats it as a real production blockchain, not as a dummy or harmless local component.
