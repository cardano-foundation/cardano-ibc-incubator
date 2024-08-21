import { useState } from "preact/hooks";
import * as State from "../State";
import { bindInput } from "../utils";
import { OptionButton, OptionButtons } from "../OptionButtons";

const CARD_WIDTH = "20rem";

export default function Page() {
  let backends = State.backends.value;

  let [adding, setAdding] = useState(false);

  const onSave = async (backend: State.BackendDef) => {
    await State.backendsAdd(backend);
    setAdding(false);
  };

  return (
    <>
      <div class="column gap-xl">
        <div class="row align-end">
          <h1 class="L4">Backend Providers</h1>
          {!adding && (
            <button class="button" onClick={() => setAdding(true)}>
              Add
              <span class="icon -add" />
            </button>
          )}
        </div>

        {adding && (
          <BackendForm
            title="Add Backend"
            onSave={onSave}
            onClose={() => setAdding(false)}
          />
        )}
      </div>

      {Object.entries(backends).map(([backendId, backend]) => (
        <>
          <Backend key={backendId} backendId={backendId} backend={backend} />
          <hr />
        </>
      ))}
    </>
  );
}

function BackendForm({
  title,
  backend,
  onSave,
  onClose,
}: {
  title: string;
  backend?: State.BackendDef;
  onSave: (backend: State.BackendDef) => void;
  onClose: () => void;
}) {
  let originalBackend = {
    name: "",
    type: "blockfrost" as State.BackendDef["type"],
    projectId: "",
    blockfrostUrl: undefined as (string | undefined),
    ogmiosUrl: "",
    kupoUrl: "",
  };
  if (backend != null) {
    originalBackend.name = backend.name;
    originalBackend.type = backend.type;
    if (backend.type == "blockfrost") {
      originalBackend.projectId = backend.projectId;
      originalBackend.blockfrostUrl = backend.url || undefined;
    } else if (backend.type == "ogmios_kupo") {
      originalBackend.ogmiosUrl = backend.ogmiosUrl;
      originalBackend.kupoUrl = backend.kupoUrl;
    }
  }

  let [type, setType] = useState(originalBackend.type);

  let [name, setName] = useState(originalBackend.name);
  let [projectId, setProjectId] = useState(originalBackend.projectId);
  let [blockfrostUrl, setBlockfrostUrl] = useState(originalBackend.blockfrostUrl);
  let [ogmiosUrl, setOgmiosUrl] = useState(originalBackend.ogmiosUrl);
  let [kupoUrl, setKupoUrl] = useState(originalBackend.kupoUrl);

  let [error, setError] = useState("");

  const onSubmit = async () => {
    let backend;
    if (type == "blockfrost") {
      backend = { type, name, projectId, url: blockfrostUrl };
    } else if (type == "ogmios_kupo") {
      backend = { type, name, ogmiosUrl, kupoUrl };
    } else {
      setError("Invalid type");
      return;
    }
    onSave(backend);
  };

  return (
    <article class="column gap-l">
      <div class="row gap-m align-end">
        <div class="L3">{title}</div>
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
      <label class="label-sub">
        Type
        <div class="row gap-m">
          <button
            class={"button" + (type != "blockfrost" ? " -secondary" : "")}
            onClick={() => setType("blockfrost")}
          >
            Blockfrost
          </button>
          <button
            class={"button" + (type != "ogmios_kupo" ? " -secondary" : "")}
            onClick={() => setType("ogmios_kupo")}
          >
            Ogmios/Kupo
          </button>
        </div>
      </label>

      {type == "blockfrost" && (
        <>
          <label class="label-sub">
            ProjectId
            <input
              placeholder="..."
              style={{ width: "30ch" }}
              value={projectId}
              onInput={bindInput(setProjectId)}
            />
          </label>
          <label class="label-sub">
            Endpoint (optional)
            <input
              placeholder="(default)"
              style={{ width: "30ch" }}
              value={blockfrostUrl}
              onInput={bindInput(setBlockfrostUrl)}
            />
          </label>
        </>
      )}

      {type == "ogmios_kupo" && (
        <>
          <label class="label-sub">
            Ogmios URL
            <input
              placeholder="..."
              style={{ width: "30ch" }}
              value={ogmiosUrl}
              onInput={bindInput(setOgmiosUrl)}
            />
          </label>
          <label class="label-sub">
            Kupo URL
            <input
              placeholder="..."
              style={{ width: "30ch" }}
              value={kupoUrl}
              onInput={bindInput(setKupoUrl)}
            />
          </label>
        </>
      )}

      <div class="color-action">{error}</div>
    </article>
  );
}

function Backend({
  backendId,
  backend,
}: {
  backendId: string;
  backend: State.BackendDef;
}) {
  let [editing, setEditing] = useState(false);

  const onEdit = async (backend: State.BackendDef) => {
    await State.backendsUpdate(backendId, backend);
    setEditing(false);
  };

  return (
    <>
      {!editing ? (
        <BackendView
          backendId={backendId}
          backend={backend}
          onEdit={() => setEditing(true)}
          showButtons
        />
      ) : (
        <BackendForm
          title="Edit Backend"
          backend={backend}
          onSave={onEdit}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

function BackendView({
  backendId,
  backend,
  showButtons,
  onEdit,
}: {
  backendId: string;
  backend: State.BackendDef;
  showButtons: boolean;
  onEdit: () => void;
}) {
  const onConfirmDelete = async () => {
    await State.backendsDelete(backendId);
  };

  const setActive = async () => {
    await State.backendsActiveSet(backendId);
  };

  let activeId = State.backendsActiveId.value;
  let isActive = backendId == activeId;

  let backendType = "Unknown";
  if (backend.type == "blockfrost") backendType = "Blockfrost";
  else if (backend.type == "ogmios_kupo") backendType = "Ogmios/Kupo";

  let setActiveButton: OptionButton[] = [];
  if (!isActive) setActiveButton = [{ text: "Set Active", onClick: setActive }];

  return (
    <article class="column gap-l">
      <div class="row align-start">
        <div class="column gap-s">
          <div class="row align-center">
            <h2 class={"L3 " + (isActive ? " color-action" : "")}
              style={{ width: CARD_WIDTH }}
            >
              {backend.name || "Unnamed"}
            </h2>
            {showButtons && (
              <BackendOptionButtons
                setActiveButton={setActiveButton}
                onEdit={onEdit}
                onConfirmDelete={onConfirmDelete}
              />
            )}
          </div>
          <div class="label-mono uncaps">{backendType}</div>
          <div class="color-action">{isActive ? "Active" : ""}</div>
        </div>
      </div>

      {backend.type == "blockfrost" && (
        <>
          <div class="gap-s">
            <label class="color-secondary">Project ID</label>
            <div>{backend.projectId}</div>
          </div>
          <div class="gap-s">
            <label class="color-secondary">Endpoint</label>
            <div>{backend.url || "(default)"}</div>
          </div>
        </>
      )}

      {backend.type == "ogmios_kupo" && (
        <>
          <div class="gap-s">
            <label class="color-secondary">Ogmios URL</label>
            <div>{backend.ogmiosUrl}</div>
          </div>

          <div class="gap-s">
            <label class="color-secondary">Kupo URL</label>
            <div>{backend.kupoUrl}</div>
          </div>
        </>
      )}
    </article>
  );
}
function BackendOptionButtons({
  setActiveButton,
  onEdit,
  onConfirmDelete,
}: {
  setActiveButton: OptionButton[];
  onEdit: () => void;
  onConfirmDelete: () => Promise<void>;
}) {
  return (
    <div class="buttons">
      <OptionButtons
        buttons={[
          ...setActiveButton,
          { text: "Edit", icon: "edit", onClick: onEdit },
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
  );
}
