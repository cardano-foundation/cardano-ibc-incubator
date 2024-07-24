import { useState } from "preact/hooks";
import * as State from "../State";
import { networkNameToId } from "../../../lib/CIP30";
import { Wallet as LibWallet } from "../../../lib/Wallet";
import { bindInput, bindInputNum } from "../utils";
import { OptionButtons } from "../OptionButtons";
import { ShortenedLabel } from "./ShortenedLabel";

const CARD_WIDTH = "20rem";

export default function Page() {
  let wallets = State.wallets.value;

  let [adding, setAdding] = useState(false);

  return (
    <>
      <div class="column gap-xl">
        <div class="row align-end">
          <h1 class="L4">Wallets</h1>
          {!adding && (
            <button class="button" onClick={() => setAdding(true)}>
              Add Wallet <span class="icon -add" />
            </button>
          )}
        </div>

        {adding && <AddWallet setAdding={setAdding} />}
      </div>

      {[...wallets].map(([walletId, wallet]) => (
        <>
          <Wallet key={walletId} walletId={walletId} wallet={wallet} />
          <hr />
        </>
      ))}
    </>
  );
}

function AddWallet({ setAdding }: { setAdding: (v: boolean) => void }) {
  let [name, setName] = useState("");
  let [keyOrMnemonics, setKeyOrMnemonics] = useState("");
  let [error, setError] = useState(false);

  const onSubmit = async () => {
    let network = State.networkActive.value;
    let networkId = networkNameToId(network);
    keyOrMnemonics = keyOrMnemonics.trim();

    let wallet;
    try {
      if (keyOrMnemonics.indexOf(" ") == -1) {
        wallet = new LibWallet({
          networkId,
          privateKey: keyOrMnemonics,
        });
      } else {
        wallet = new LibWallet({
          networkId,
          mnemonics: keyOrMnemonics.split(" "),
        });
      }
      await State.walletsAdd(name, wallet);
      setAdding(false);
    } catch (e) {
      setError(true);
    }
  };
  return (
    <article class="column gap-m">
      <div class="row gap-m align-end">
        <div class="L3">Add Wallet</div>
        <div class="row gap-s">
          <button class="button" onClick={onSubmit}>
            Save <span class="icon -save" />
          </button>
          <button class="button -secondary" onClick={() => setAdding(false)}>
            Cancel <span class="icon -close" />
          </button>
        </div>
      </div>
      <label class="label-sub">
        Name
        <input
          placeholder="Unnamed"
          style={{ width: "30ch" }}
          value={name}
          onInput={bindInput(setName)}
        />
      </label>
      <label class="label-sub">
        Root Key or Mnemonics
        <textarea
          style={{ width: "30ch", height: "30ch" }}
          value={keyOrMnemonics}
          onInput={bindInput(setKeyOrMnemonics)}
        ></textarea>
      </label>
      <div class="color-action">{error && "Invalid Root Key / Mnemonics"}</div>
    </article>
  );
}

function Wallet({
  walletId,
  wallet,
}: {
  walletId: string;
  wallet: State.WalletDef;
}) {
  let [action, setAction] = useState<"add_account" | "rename" | null>(null);

  let accounts = State.accounts.value;
  let ourAccounts = [...accounts].filter(
    ([_acIdx, ac]) => ac.walletId == walletId,
  );
  ourAccounts.sort(
    ([_id1, ac1], [_id2, ac2]) => ac1.accountIdx - ac2.accountIdx,
  );

  const onConfirmDelete = async () => {
    await State.walletsDelete(walletId);
  };

  return (
    <article class="column gap-xl">
      <WalletHeader
        wallet={wallet}
        onAddAccount={() => setAction("add_account")}
        onRename={() => setAction("rename")}
        onConfirmDelete={onConfirmDelete}
        showButtons={action == null}
      />

      {action == "add_account" && (
        <AddAccount walletId={walletId} onClose={() => setAction(null)} />
      )}

      {action == "rename" && (
        <RenameWallet
          name={wallet.name}
          walletId={walletId}
          onClose={() => setAction(null)}
        />
      )}

      {/* Accounts */}

      {ourAccounts.map(([acId, ac]) => (
        <Account key={acId} acId={acId} ac={ac} />
      ))}
    </article>
  );
}

function WalletHeader({
  wallet,
  showButtons,
  onAddAccount,
  onRename,
  onConfirmDelete,
}: {
  wallet: State.WalletDef;
  showButtons: boolean;
  onAddAccount: () => void;
  onRename: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <div class="row align-start">
      <div class="column gap-s" style={{ width: CARD_WIDTH }}>
        <h2 class="L3">{wallet.name || "Unnamed"}</h2>
        <ShortenedLabel
          classes="label-mono uncaps"
          text={wallet.wallet.rootKey.to_bech32()}
          prefixLen={15}
          suffixLen={6}
        />
      </div>

      {showButtons && (
        <div class="buttons">
          <button class="button" onClick={onAddAccount}>
            Add Account <span class="icon -add" />
          </button>
          <OptionButtons
            buttons={[
              { text: "Rename", icon: "edit", onClick: onRename },
              {
                text: "Delete",
                icon: "delete",
                expand: {
                  backText: "Cancel",
                  buttons: [
                    {
                      text: "Confirm Delete",
                      icon: "delete",
                      onClick: onConfirmDelete,
                    },
                  ],
                },
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}

function RenameWallet({
  walletId,
  onClose,
  ...rest
}: {
  walletId: string;
  name: string;
  onClose: () => void;
}) {
  let [name, setName] = useState(rest.name);

  const onSubmit = async () => {
    await State.walletsRename(walletId, name);
    onClose();
  };

  return (
    <article class="column gap-m">
      <div class="row gap-m align-end">
        <div class="L4">Rename Wallet</div>
        <div class="row gap-s">
          <button class="button" onClick={onSubmit}>
            Save <span class="icon -save" />
          </button>
          <button class="button -secondary" onClick={onClose}>
            Cancel <span class="icon -close" />
          </button>
        </div>
      </div>
      <label class="label-sub">
        Name
        <input
          placeholder="Unnamed"
          style={{ width: "30ch" }}
          value={name}
          onInput={bindInput(setName)}
        />
      </label>
    </article>
  );
}
function AddAccount({
  walletId,
  onClose,
}: {
  walletId: string;
  onClose: () => void;
}) {
  let [idx, setIdx] = useState("0");

  const onSubmit = async () => {
    await State.accountsAdd({
      name: "Unnamed",
      walletId,
      accountIdx: parseInt(idx),
    });
    onClose();
  };
  return (
    <article class="column gap-m">
      <div class="row gap-xl align-end">
        <div class="L4">Add Account</div>
        <div class="row gap-s">
          <button class="button" onClick={onSubmit}>
            Save <span class="icon -save" />
          </button>
          <button class="button -secondary" onClick={onClose}>
            Cancel <span class="icon -close" />
          </button>
        </div>
      </div>
      <label class="L5 uncaps">m(1852'/1815'/_)
        <input
          placeholder="Unnamed"
          style={{ width: "30ch" }}
          value={idx}
          onInput={bindInputNum(idx, setIdx)}
        /></label>
    </article>
  );
}

function Account({ acId, ac }: { acId: string; ac: State.AccountDef }) {
  let derivation = "m(1852'/1815'/" + ac.accountIdx + "')";
  let address = ac.account.baseAddress.to_address().to_bech32();

  const onDeleteConfirm = async () => {
    await State.accountsDelete(acId);
  };

  const setActive = async () => {
    await State.accountsActiveSet(acId);
  };

  let activeId = State.accountsActiveId.value;
  let isActive = activeId == acId;

  let optionButtons = [];
  if (!isActive)
    optionButtons.push({
      text: "Set Active",
      icon: "",
      onClick: setActive,
    });
  optionButtons.push({
    text: "Delete",
    icon: "delete",
    expand: {
      backText: "Cancel",
      buttons: [
        {
          text: "Confirm Delete",
          icon: "delete",
          onClick: onDeleteConfirm,
        },
      ],
    },
  });

  return (
    <article class="expand-child">
      <div class="row align-start">
        <div class="column gap-s" style={{ width: CARD_WIDTH }}>
          <div class={"row gap-s align-end " + (isActive ? "color-action" : "")}>
            <span class="L4">{derivation}</span>
            {isActive && <span>Active</span>}
          </div>
          <ShortenedLabel
            classes="label-mono uncaps"
            text={address}
            prefixLen={15}
            suffixLen={6}
          />
        </div>
        <div class="buttons">
          <OptionButtons buttons={optionButtons} />
        </div>
      </div>
    </article>
  );
}
