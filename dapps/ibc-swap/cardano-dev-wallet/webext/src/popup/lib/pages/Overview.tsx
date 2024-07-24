import { useEffect, useState } from "preact/hooks";
import { WalletApiInternal } from "../../../lib/CIP30";
import * as State from "../State";
import { bindInputNum, lovelaceToAda } from "../utils";

import { CSLIterator } from "../../../lib/CSLIterator";
import * as CSL from "@emurgo/cardano-serialization-lib-browser";
import { Utxo } from "../../../lib/CIP30/State";
import { ShortenedLabel } from "./ShortenedLabel";

const CARD_WIDTH = "20rem";

export default function Page() {
  let activeAccount = State.accountsActive.value;

  let api = State.API.value;

  return (
    <>
      <section class="row">
        {activeAccount != null && <ActiveAccount account={activeAccount} />}
      </section>
      {api == "NO_ACCOUNT" && (
        <div class="L2">No active account configured</div>
      )}
      {api == "NO_BACKEND" && (
        <div class="L2">No active backend configured</div>
      )}
      {api instanceof WalletApiInternal && <NetworkData api={api} />}
    </>
  );
}

function ActiveAccount({ account }: { account: State.ActiveAccountDef }) {
  let accountIdx = account.accountDef.accountIdx;
  let derivation = "m(1852'/1815'/" + accountIdx + "')";
  let address = account.accountDef.account.baseAddress.to_address().to_bech32();
  return (
    <article class="column gap-s">
      <h1 class="L3">{account.walletDef.name}</h1>
      <div>{derivation}</div>
      <ShortenedLabel
        classes="label-mono uncaps"
        text={address}
        prefixLen={15}
        suffixLen={6}
      />
    </article>
  );
}

function NetworkData({ api }: { api: WalletApiInternal }) {
  return (
    <>
      <Balance api={api} />
      <div class="row">
        <UTxOs api={api} />
        <Collateral api={api} />
      </div>
    </>
  );
}

function Balance({ api }: { api: WalletApiInternal }) {
  let [balance, setBalance] = useState<string | null>(null);
  useEffect(() => {
    setBalance(null);
    api.getBalance().then((balance) => {
      let balanceAda = lovelaceToAda(balance.coin());
      setBalance(balanceAda.toString());
    });
  }, [api, State.overrides.value]);

  let override = State.overrides.value?.balance;

  let [overrideEditing, setOverrideEditing] = useState(false);
  const onOverrideSave = async (value: string) => {
    let overrides = State.overrides?.value || {};
    if (value != balance) {
      overrides.balance = value;
    } else {
      overrides.balance = null;
    }
    await State.overridesSet(overrides);
    setOverrideEditing(false);
  };

  const onOverrideReset = async () => {
    let overrides = State.overrides?.value || {};
    overrides.balance = null;
    await State.overridesSet(overrides);
  };

  return (
    <>
      <section class="column gap-s">
        {!overrideEditing ? (
          <BalanceNotEditing
            balance={balance}
            override={override}
            currencySymbol={State.adaSymbol.value}
            onEdit={() => setOverrideEditing(true)}
            onReset={onOverrideReset}
          />
        ) : (
          <BalanceEditing
            balance={balance!}
            override={override}
            currencySymbol={State.adaSymbol.value}
            onSave={onOverrideSave}
            onCancel={() => setOverrideEditing(false)}
          />
        )}
      </section>
    </>
  );
}

function BalanceNotEditing({
  balance,
  override,
  currencySymbol,
  onEdit,
  onReset,
}: {
  balance: string | null;
  override?: string | null;
  currencySymbol: string;
  onEdit: () => void;
  onReset: () => void;
}) {
  let balanceDisplay = balance == null ? "..." : balance;
  return (
    <>
      <div class="row gap-l align-end">
        {override == null ? (
          <>
            <BalanceComponent
              title="Balance"
              balance={balanceDisplay}
              currencySymbol={currencySymbol}
            />
          </>
        ) : (
          <>
            <BalanceComponent
              title="Balance"
              balance={override}
              currencySymbol={currencySymbol}
            />
            <BalanceComponent
              title="Original"
              balance={balanceDisplay}
              currencySymbol={currencySymbol}
              small
            />
          </>
        )}
      </div>
      <div class={(balance == null ? "hidden" : "") + " buttons"}>
        {override == null ? (
          <>
            <button class="button" onClick={onEdit}>
              Override <span class="icon -edit" />
            </button>
          </>
        ) : (
          <>
            <button class="button" onClick={onEdit}>
              Edit Override <span class="icon -edit" />
            </button>
            <button class="button -secondary" onClick={onReset}>
              Reset <span class="icon -close" />
            </button>
          </>
        )}
      </div>
    </>
  );
}

function BalanceEditing({
  balance,
  override,
  currencySymbol,
  onSave,
  onCancel,
}: {
  balance: string;
  override?: string | null;
  currencySymbol: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  let [input, setInput] = useState(override == null ? balance : override);
  return (
    <>
      <div class="row">
        <BalanceComponent
          title="Balance"
          balance={input}
          setBalance={setInput}
          currencySymbol={currencySymbol}
          editable
        />
        <BalanceComponent
          title="Original"
          balance={balance}
          currencySymbol={currencySymbol}
          small
        />
      </div>
      <div class="buttons">
        <>
          <button class="button" onClick={() => onSave(input)}>
            Save <span class="icon -save" />
          </button>
          <button class="button -secondary" onClick={onCancel}>
            Cancel <span class="icon -close" />
          </button>
        </>
      </div>
    </>
  );
}

function BalanceComponent({
  title,
  balance,
  setBalance,
  currencySymbol,
  small,
  editable,
}: {
  title: string;
  balance: string;
  setBalance?: (val: string) => void;
  currencySymbol: string;
  small?: boolean;
  editable?: boolean;
}) {
  return (
    <article class="item">
      <h1 class={!small ? "label" : "label-sub"}>{title}</h1>
      <div class={!small ? "currency" : "currency -small"}>
        <input
          class="-amount"
          value={balance}
          onInput={
            editable && setBalance
              ? bindInputNum(balance, setBalance)
              : undefined
          }
          readonly={!editable}
          style={{ width: balance.length + 1.1 + "ex" }}
        />
        <div class="-unit">{currencySymbol}</div>
      </div>
    </article>
  );
}

function UTxOs({ api }: { api: WalletApiInternal }) {
  let [utxos, setUtxos] = useState<UtxoDef[] | null>(null);
  let [utxosFiltered, setUtxosFiltered] = useState<UtxoDef[] | null>(null);

  useEffect(() => {
    setUtxos(null);
    api.getUtxos().then((utxos) => {
      if (utxos == null) return;
      let utxosParsed = utxos?.map(parseUtxo);
      setUtxos(utxosParsed);
    });
  }, [api]);

  useEffect(() => {
    if (utxos == null) {
      setUtxosFiltered(null);
      return;
    }
    let utxosFiltered = utxos?.map((x) =>
      hideUtxo(x, State.overrides.value?.hiddenUtxos || []),
    );
    setUtxosFiltered(utxosFiltered);
  }, [utxos, State.overrides.value]);

  const onHide = async (txHash: string, txIdx: number) => {
    let overrides = State.overrides.value;
    let hiddenUtxos = overrides.hiddenUtxos || [];
    hiddenUtxos.push({ txHashHex: txHash, idx: txIdx });
    overrides.hiddenUtxos = hiddenUtxos;
    await State.overridesSet(overrides);
  };

  const onShow = async (txHash: string, txIdx: number) => {
    let overrides = State.overrides.value;
    let hiddenUtxos = overrides.hiddenUtxos || [];
    hiddenUtxos = hiddenUtxos.filter(
      (h) => !(h.txHashHex == txHash && h.idx == txIdx),
    );
    overrides.hiddenUtxos = hiddenUtxos;
    await State.overridesSet(overrides);
  };

  return (
    <UtxoList
      title="UTxOs"
      utxos={utxosFiltered}
      onHide={onHide}
      onShow={onShow}
    />
  );
}

function Collateral({ api }: { api: WalletApiInternal }) {
  let [utxos, setUtxos] = useState<UtxoDef[] | null>(null);
  let [utxosFiltered, setUtxosFiltered] = useState<UtxoDef[] | null>(null);

  useEffect(() => {
    setUtxos(null);
    api.getCollateral().then((utxos) => {
      if (utxos == null) {
        setUtxos([]);
        return;
      }
      let utxosParsed = utxos?.map(parseUtxo);
      setUtxos(utxosParsed);
    });
  }, [api]);

  useEffect(() => {
    if (utxos == null) {
      setUtxosFiltered(null);
      return;
    }
    let utxosFiltered = utxos?.map((x) =>
      hideUtxo(x, State.overrides.value?.hiddenCollateral || []),
    );
    setUtxosFiltered(utxosFiltered);
  }, [utxos, State.overrides.value]);

  const onHide = async (txHash: string, txIdx: number) => {
    let overrides = State.overrides.value;
    let hiddenCollateral = overrides.hiddenCollateral || [];
    hiddenCollateral.push({ txHashHex: txHash, idx: txIdx });
    overrides.hiddenCollateral = hiddenCollateral;
    await State.overridesSet(overrides);
  };

  const onShow = async (txHash: string, txIdx: number) => {
    let overrides = State.overrides.value;
    let hiddenCollateral = overrides.hiddenCollateral || [];
    hiddenCollateral = hiddenCollateral.filter(
      (h) => !(h.txHashHex == txHash && h.idx == txIdx),
    );
    overrides.hiddenCollateral = hiddenCollateral;
    await State.overridesSet(overrides);
  };

  return (
    <UtxoList
      title="Collateral"
      utxos={utxosFiltered}
      onShow={onShow}
      onHide={onHide}
    />
  );
}

interface UtxoDef {
  hidden: boolean;
  txHashHex: string;
  txIdx: number;
  amount: string;
  tokens: {
    policyId: string;
    assetName: string;
    amount: string;
  }[];
}

function parseUtxo(u: CSL.TransactionUnspentOutput): UtxoDef {
  let input = u.input();
  let txHashHex = input.transaction_id().to_hex();
  let txIdx = input.index();

  let txAmount = u.output().amount();
  let amount = lovelaceToAda(txAmount.coin()).toString();

  let tokens = [];
  let multiasset = txAmount.multiasset();
  for (let policyId of new CSLIterator(multiasset?.keys())) {
    let asset = multiasset!.get(policyId);
    for (let assetName of new CSLIterator(asset?.keys())) {
      let assetAmount = asset!.get(assetName)!.to_str();
      let assetNameStr = Buffer.from(assetName.to_js_value(), "hex").toString();
      tokens.push({
        policyId: policyId.to_hex(),
        assetName: assetNameStr,
        amount: assetAmount,
      });
    }
  }

  return {
    hidden: false,
    txHashHex,
    txIdx,
    amount,
    tokens,
  };
}

function hideUtxo(utxo: UtxoDef, hiddenList: Utxo[]) {
  let hidden =
    hiddenList.find(
      (h) => h.txHashHex == utxo.txHashHex && h.idx == utxo.txIdx,
    ) != null;
  return {
    ...utxo,
    hidden,
  };
}

function UtxoList({
  title,
  utxos,
  onHide,
  onShow,
}: {
  title: string;
  utxos: UtxoDef[] | null;
  onHide?: (txHash: string, txIdx: number) => void;
  onShow?: (txHash: string, txIdx: number) => void;
}) {
  return (
    <section class="column gap-xl" style={{ width: CARD_WIDTH }}>
      <div class="gap-m">
        <h2 class="L3">{title}</h2>
        {utxos?.length == 0 && <div class="color-secondary">(empty)</div>}
      </div>
      {utxos == null && <div class="L2">...</div>}
      {utxos != null &&
        utxos.map((utxo) => {
          return (
            <>
              <article class={"column" + (utxo.hidden ? " faded" : "")}>
                <UtxoHeader utxo={utxo} onHide={onHide} onShow={onShow} />
                {utxo.tokens.map((token) => {
                  return <UtxoToken token={token} />;
                })}
              </article>
              <hr />
            </>
          );
        })}
    </section>
  );
}

function UtxoHeader({
  utxo,
  onHide,
  onShow,
}: {
  utxo: UtxoDef;
  onHide?: (txHash: string, txIdx: number) => void;
  onShow?: (txHash: string, txIdx: number) => void;
}) {
  return (
    <div class="column gap-s">
      {!utxo.hidden ? (
        <button
          class="button"
          onClick={() => onHide && onHide(utxo.txHashHex, utxo.txIdx)}
        >
          Hide <span class="icon -hidden" />
        </button>
      ) : (
        <button
          class="button"
          onClick={() => onShow && onShow(utxo.txHashHex, utxo.txIdx)}
        >
          Show <span class="icon -visible" />
        </button>
      )}
      <ShortenedLabel
        classes="label-mono"
        text={utxo.txHashHex}
        prefixLen={10}
        suffixLen={6}
      />
      <div class="currency -small">
        <h3 class="-amount">{utxo.amount}</h3>
        <h3 class="-unit">{State.adaSymbol.value}</h3>
      </div>
    </div>
  );
}

function UtxoToken({
  token,
}: {
  token: { policyId: string; assetName: string; amount: string };
}) {
  return (
    <div class="column gap-s">
      <div>{token.assetName}</div>
      <ShortenedLabel
        classes="label-mono-sub"
        text={token.policyId}
        prefixLen={10}
        suffixLen={6}
      />
      <div class="currency -xsmall">
        <h3 class="-amount">{token.amount}</h3>
        {token.amount == "1" ? (
          <h3 class="-unit">unit</h3>
        ) : (
          <h3 class="-unit">units</h3>
        )}
      </div>
    </div>
  );
}
