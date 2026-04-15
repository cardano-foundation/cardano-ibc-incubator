import { DeploymentConfig } from 'src/config/bridge-manifest';
import { ICQ_MODULE_PORT, MOCK_MODULE_PORT, PORT_ID_PREFIX, TRANSFER_MODULE_PORT } from 'src/constant';

export type GatewayModuleKey = 'transfer' | 'mock' | 'icq';

export type GatewayModuleConfig = {
  key: GatewayModuleKey;
  canonicalPortId: 'transfer' | 'mock' | 'icqhost';
  identifier: string;
  address: string;
  referenceScript: 'spendTransferModule' | 'spendMockModule';
};

export function normalizeGatewayPortId(portId: string): string {
  const normalized = portId.trim().toLowerCase();
  switch (normalized) {
    case 'transfer':
    case `${PORT_ID_PREFIX}-${TRANSFER_MODULE_PORT}`:
      return 'transfer';
    case 'mock':
    case `${PORT_ID_PREFIX}-${MOCK_MODULE_PORT}`:
      return 'mock';
    case 'icqhost':
    case `${PORT_ID_PREFIX}-${ICQ_MODULE_PORT}`:
      return 'icqhost';
    default:
      return normalized;
  }
}

export function isSupportedGatewayPortId(portId: string): boolean {
  const normalized = normalizeGatewayPortId(portId);
  return normalized === 'transfer' || normalized === 'mock' || normalized === 'icqhost';
}

export function getGatewayModuleConfigForPortId(
  deployment: DeploymentConfig,
  portId: string,
): GatewayModuleConfig {
  switch (normalizeGatewayPortId(portId)) {
    case 'transfer':
      return {
        key: 'transfer',
        canonicalPortId: 'transfer',
        identifier: deployment.modules.transfer.identifier,
        address: deployment.modules.transfer.address,
        referenceScript: 'spendTransferModule',
      };
    case 'mock':
      if (!deployment.modules.mock) {
        throw new Error('Deployment is missing modules.mock for the mock port');
      }
      if (!deployment.validators.spendMockModule) {
        throw new Error('Deployment is missing validators.spendMockModule for the mock port');
      }
      return {
        key: 'mock',
        canonicalPortId: 'mock',
        identifier: deployment.modules.mock.identifier,
        address: deployment.modules.mock.address,
        referenceScript: 'spendMockModule',
      };
    case 'icqhost':
      if (!deployment.modules.icq) {
        throw new Error('Deployment is missing modules.icq for the icqhost port');
      }
      if (!deployment.validators.spendMockModule) {
        throw new Error('Deployment is missing validators.spendMockModule for the icqhost port');
      }
      return {
        key: 'icq',
        canonicalPortId: 'icqhost',
        identifier: deployment.modules.icq.identifier,
        address: deployment.modules.icq.address,
        referenceScript: 'spendMockModule',
      };
    default:
      throw new Error(`Unsupported IBC port: ${portId}`);
  }
}
