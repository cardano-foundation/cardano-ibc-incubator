export const EVENT_TYPE_CLIENT = {
  CREATE_CLIENT: 'create_client',
  UPDATE_CLIENT: 'update_client',
  UPGRADE_CLIENT: 'upgrade_client',
  CLIENT_MISBEHAVIOR: 'client_misbehaviour',
  UPDATE_CLIENT_PROPOSAL: 'update_client_proposal',
  UPGRADE_CHAIN: 'upgrade_chain',
  UPGRADE_CLIENT_PROPOSAL: 'upgrade_client_proposal',
};

export const ATTRIBUTE_KEY_CLIENT = {
  CLIENT_ID: 'client_id',
  SUBJECT_CLIENT_ID: 'subject_client_id',
  CLIENT_TYPE: 'client_type',
  CONSENSUS_HEIGHT: 'consensus_height',
  CONSENSUS_HEIGHTS: 'consensus_heights',
  HEADER: 'header',
  UPGRADE_STORE: 'upgrade_store',
  UPGRADE_PLAN_HEIGHT: 'upgrade_plan_height',
  title: 'title',
};
// Cardano stores Tendermint clients using the canonical IBC client identifier format:
// `07-tendermint-{sequence}`.
export const CLIENT_ID_PREFIX = '07-tendermint';
export const KEY_CLIENT_PREFIX = 'clients';
export const KEY_CLIENT_STATE = 'clientState';

export const MAX_CONSENSUS_STATE_SIZE = 300;
