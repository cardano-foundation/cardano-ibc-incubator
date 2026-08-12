use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info, MockApi};
use cosmwasm_std::{from_binary, Addr, Coin, DepsMut};

use crate::contract;
use crate::msg::{ExecuteMsg, GetOwnerResponse, InstantiateMsg, QueryMsg};

// test helper
#[allow(unused_assignments)]
fn initialize_contract(deps: DepsMut) -> Addr {
    let creator = MockApi::default().addr_make("creator");
    let msg = InstantiateMsg {
        owner: creator.to_string(),
    };
    let info = mock_info(creator.as_str(), &[]);

    // instantiate with enough funds provided should succeed
    contract::instantiate(deps, mock_env(), info.clone(), msg).unwrap();

    info.sender
}

#[test]
fn proper_initialization() {
    let mut deps = mock_dependencies();

    let owner = initialize_contract(deps.as_mut());

    // it worked, let's query the state
    let res: GetOwnerResponse =
        from_binary(&contract::query(deps.as_ref(), mock_env(), QueryMsg::GetOwner {}).unwrap())
            .unwrap();
    assert_eq!(owner.as_str(), res.owner);
}

#[test]
fn proper_transfer() {
    let mut deps = mock_dependencies();

    let owner = initialize_contract(deps.as_mut());

    // it worked, let's query the state
    let res: GetOwnerResponse =
        from_binary(&contract::query(deps.as_ref(), mock_env(), QueryMsg::GetOwner {}).unwrap())
            .unwrap();
    assert_eq!(owner.as_str(), res.owner);

    let good_addr = MockApi::default().addr_make("new_owner").to_string();

    let other_sender = MockApi::default().addr_make("other_sender");
    let other_info = mock_info(other_sender.as_str(), &vec![] as &Vec<Coin>);
    let owner_info = mock_info(owner.as_str(), &vec![] as &Vec<Coin>);

    // valid addr, bad sender
    let msg = ExecuteMsg::TransferOwnership {
        new_owner: good_addr.clone(),
    };
    contract::execute(deps.as_mut(), mock_env(), other_info, msg).unwrap_err();

    // and transfer ownership
    let msg = ExecuteMsg::TransferOwnership {
        new_owner: good_addr.clone(),
    };
    contract::execute(deps.as_mut(), mock_env(), owner_info, msg).unwrap();

    let res: GetOwnerResponse =
        from_binary(&contract::query(deps.as_ref(), mock_env(), QueryMsg::GetOwner {}).unwrap())
            .unwrap();
    assert_eq!(good_addr, res.owner);
}
