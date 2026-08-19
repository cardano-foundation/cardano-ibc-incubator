import { DeploymentConfig } from 'src/config/bridge-manifest';

export type GatewayModuleKey = 'transfer' | 'mock' | 'icq';

export type GatewayModuleConfig = {
  key: GatewayModuleKey;
  canonicalPortId: 'transfer' | 'mock' | 'icqhost';
  identifier: string;
  address: string;
  referenceScript: 'spendTransferModule' | 'spendMockModule';
};

export function isSupportedGatewayPortId(portId: string): boolean {
  return portId === 'transfer' || portId === 'mock' || portId === 'icqhost';
}

export function getGatewayModuleConfigForPortId(deployment: DeploymentConfig, portId: string): GatewayModuleConfig {
  // Port identifiers are exact, case-sensitive commitment-path bytes. Do not
  // trim, lowercase, or route legacy numeric aliases under another identity.
  switch (portId) {
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
