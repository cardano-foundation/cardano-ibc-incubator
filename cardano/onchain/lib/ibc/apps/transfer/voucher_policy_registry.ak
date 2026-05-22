use aiken/collection/list
use cardano/assets.{PolicyId}

pub type VoucherPolicyRegistry {
  active: PolicyId,
  legacy: List<PolicyId>,
}

pub fn operational_policies(registry: VoucherPolicyRegistry) -> List<PolicyId> {
  registry.legacy |> list.push(registry.active)
}

pub fn is_active(registry: VoucherPolicyRegistry, policy_id: PolicyId) -> Bool {
  registry.active == policy_id
}

pub fn is_legacy(registry: VoucherPolicyRegistry, policy_id: PolicyId) -> Bool {
  list.has(registry.legacy, policy_id)
}

pub fn is_operational(
  registry: VoucherPolicyRegistry,
  policy_id: PolicyId,
) -> Bool {
  is_active(registry, policy_id) || is_legacy(registry, policy_id)
}
