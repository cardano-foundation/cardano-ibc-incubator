import { TxBuilder } from '@lucid-evolution/lucid';
import { ConfigService } from '@nestjs/config';

type TxValidityOptions = {
  validFromMs?: number;
  validToMs?: number;
  requireUpperBound?: boolean;
};

const LOCAL_DEVNET_REQUIRED_UPPER_BOUND_MAX_MS = 30_000;

export function isLocalCardanoDevnet(configService: ConfigService): boolean {
  const networkMagic = Number(configService.get<number>('cardanoChainNetworkMagic') ?? 42);
  const chainId = configService.get<string>('cardanoChainId') ?? 'cardano-devnet';
  return networkMagic === 42 || chainId === 'cardano-devnet';
}

export function capGatewayRequiredUpperBoundMs(
  configService: ConfigService,
  validToMs: number,
  nowMs: number = Date.now(),
): number {
  if (!isLocalCardanoDevnet(configService)) {
    return validToMs;
  }

  // Local devnet's Ogmios forecast horizon is short. When a validator genuinely requires
  // `tx_valid_to`, keep the upper bound close to the current tip so evaluation stays inside
  // the known era summaries.
  return Math.min(validToMs, nowMs + LOCAL_DEVNET_REQUIRED_UPPER_BOUND_MAX_MS);
}

export function applyGatewayTxValidity(
  builder: TxBuilder,
  configService: ConfigService,
  options: TxValidityOptions,
): TxBuilder {
  const { validFromMs, validToMs, requireUpperBound = false } = options;

  let withValidity = builder;
  if (validFromMs !== undefined) {
    withValidity = withValidity.validFrom(validFromMs);
  }

  // Local devnet has a very short forecast horizon in Ogmios evaluation. IBC core validators
  // still depend on `tx_valid_to`, so we keep the upper bound but cap it close to the tip
  // instead of using the full wallclock TTL that would push evaluation past the known era.
  if (validToMs !== undefined) {
    withValidity = withValidity.validTo(
      requireUpperBound || isLocalCardanoDevnet(configService)
        ? capGatewayRequiredUpperBoundMs(configService, validToMs)
        : validToMs,
    );
  }

  return withValidity;
}
