(function () {
  const model = window.PROTOCOL_MODEL;
  const state = {
    phase: "packet",
    query: "",
    operationId: "send-packet",
    selected: null,
  };

  const el = {
    phaseTabs: document.getElementById("phaseTabs"),
    operationSearch: document.getElementById("operationSearch"),
    operationList: document.getElementById("operationList"),
    operationPhase: document.getElementById("operationPhase"),
    operationTitle: document.getElementById("operationTitle"),
    operationSummary: document.getElementById("operationSummary"),
    validatorCount: document.getElementById("validatorCount"),
    inputCount: document.getElementById("inputCount"),
    hostKeyCount: document.getElementById("hostKeyCount"),
    transactionCanvas: document.getElementById("transactionCanvas"),
    inspectorHint: document.getElementById("inspectorHint"),
    inspectorBody: document.getElementById("inspectorBody"),
    lifecycleTitle: document.getElementById("lifecycleTitle"),
    lifecyclePanel: document.getElementById("lifecyclePanel"),
    choreographyList: document.getElementById("choreographyList"),
    hostKeyList: document.getElementById("hostKeyList"),
    invariantList: document.getElementById("invariantList"),
    replayButton: document.getElementById("replayButton"),
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function currentOperation() {
    return model.operations.find((operation) => operation.id === state.operationId) || model.operations[0];
  }

  function phaseLabel(phaseId) {
    const phase = model.phases.find((item) => item.id === phaseId);
    return phase ? phase.label : "All";
  }

  function searchableText(operation) {
    const validators = operation.validators.map((id) => model.validators[id].label).join(" ");
    return [
      operation.title,
      operation.summary,
      operation.phase,
      validators,
      operation.hostState.join(" "),
      operation.invariants.join(" "),
    ]
      .join(" ")
      .toLowerCase();
  }

  function filteredOperations() {
    const query = state.query.trim().toLowerCase();
    return model.operations.filter((operation) => {
      const phaseMatch = state.phase === "all" || operation.phase === state.phase;
      const queryMatch = query.length === 0 || searchableText(operation).includes(query);
      return phaseMatch && queryMatch;
    });
  }

  function renderPhaseTabs() {
    const phases = [{ id: "all", label: "All" }].concat(model.phases);
    el.phaseTabs.innerHTML = phases
      .map(
        (phase) => `
          <button class="phase-tab ${phase.id === state.phase ? "active" : ""}" type="button" data-phase="${phase.id}">
            ${escapeHtml(phase.label)}
          </button>
        `,
      )
      .join("");

    el.phaseTabs.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        state.phase = button.dataset.phase;
        const operations = filteredOperations();
        if (operations.length > 0 && !operations.some((operation) => operation.id === state.operationId)) {
          state.operationId = operations[0].id;
          state.selected = null;
        }
        render();
      });
    });
  }

  function renderOperationList() {
    const operations = filteredOperations();
    if (operations.length === 0) {
      el.operationList.innerHTML = '<p class="inspector-copy">No operations match this filter.</p>';
      return;
    }

    el.operationList.innerHTML = operations
      .map(
        (operation) => `
          <button class="operation-button ${operation.id === state.operationId ? "active" : ""}" type="button" data-operation="${operation.id}">
            <strong>${escapeHtml(operation.title)}</strong>
            <span>${escapeHtml(operation.summary)}</span>
          </button>
        `,
      )
      .join("");

    el.operationList.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        state.operationId = button.dataset.operation;
        state.selected = null;
        render();
      });
    });
  }

  function nodeMarkup(node, kind) {
    const active = state.selected && state.selected.type === "node" && state.selected.id === node.id;
    return `
      <button class="tx-node node-${kind} ${active ? "active" : ""}" type="button" data-node-id="${escapeHtml(node.id)}" data-node-kind="${kind}">
        <strong>${escapeHtml(node.label)}</strong>
        <span>${escapeHtml(node.detail)}</span>
      </button>
    `;
  }

  function validatorMarkup(id) {
    const validator = model.validators[id];
    const active = state.selected && state.selected.type === "validator" && state.selected.id === id;
    return `
      <button class="tx-node node-host ${active ? "active" : ""}" type="button" data-validator-id="${escapeHtml(id)}">
        <strong>${escapeHtml(validator.label)}</strong>
        <span>${escapeHtml(validator.role)}</span>
      </button>
    `;
  }

  function renderTransaction(operation) {
    const columns = [
      { label: "Inputs", items: operation.inputs, kind: "input" },
      { label: "References", items: operation.references, kind: "reference" },
      { label: "Mint / Burn", items: operation.mint, kind: "mint" },
      { label: "Outputs", items: operation.outputs, kind: "output" },
      { label: "Validators", validators: operation.validators },
    ];

    el.transactionCanvas.innerHTML = `
      <svg class="connector-layer" aria-hidden="true"></svg>
      <div class="transaction-grid">
        ${columns
          .map((column) => {
            const body = column.validators
              ? column.validators.map(validatorMarkup).join("")
              : column.items.length > 0
                ? column.items.map((item) => nodeMarkup(item, column.kind)).join("")
                : '<div class="tx-node"><strong>Not used</strong><span>This operation does not require this transaction role.</span></div>';
            return `
              <div class="tx-column">
                <h4>${escapeHtml(column.label)}</h4>
                ${body}
              </div>
            `;
          })
          .join("")}
      </div>
    `;

    el.transactionCanvas.querySelectorAll("[data-node-id]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selected = {
          type: "node",
          id: button.dataset.nodeId,
          kind: button.dataset.nodeKind,
        };
        renderInspector(operation);
        markSelectedNodes();
      });
    });

    el.transactionCanvas.querySelectorAll("[data-validator-id]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selected = {
          type: "validator",
          id: button.dataset.validatorId,
        };
        renderInspector(operation);
        markSelectedNodes();
      });
    });

    requestAnimationFrame(() => drawConnectors(operation));
  }

  function markSelectedNodes() {
    el.transactionCanvas.querySelectorAll(".tx-node.active").forEach((node) => node.classList.remove("active"));
    if (!state.selected) return;
    const selector =
      state.selected.type === "node"
        ? `[data-node-id="${CSS.escape(state.selected.id)}"]`
        : `[data-validator-id="${CSS.escape(state.selected.id)}"]`;
    const selected = el.transactionCanvas.querySelector(selector);
    if (selected) selected.classList.add("active");
  }

  function drawConnectors(operation) {
    const svg = el.transactionCanvas.querySelector(".connector-layer");
    if (!svg) return;

    const canvasRect = el.transactionCanvas.getBoundingClientRect();
    const width = Math.max(el.transactionCanvas.scrollWidth, el.transactionCanvas.clientWidth);
    const height = Math.max(el.transactionCanvas.scrollHeight, el.transactionCanvas.clientHeight);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.innerHTML = "";

    operation.links.forEach(([fromId, toId], index) => {
      const from = el.transactionCanvas.querySelector(`[data-node-id="${CSS.escape(fromId)}"]`);
      const to = el.transactionCanvas.querySelector(`[data-node-id="${CSS.escape(toId)}"]`);
      if (!from || !to) return;

      const fromRect = from.getBoundingClientRect();
      const toRect = to.getBoundingClientRect();
      const x1 = fromRect.right - canvasRect.left + el.transactionCanvas.scrollLeft;
      const y1 = fromRect.top + fromRect.height / 2 - canvasRect.top + el.transactionCanvas.scrollTop;
      const x2 = toRect.left - canvasRect.left + el.transactionCanvas.scrollLeft;
      const y2 = toRect.top + toRect.height / 2 - canvasRect.top + el.transactionCanvas.scrollTop;
      const bend = Math.max(50, Math.abs(x2 - x1) * 0.38);
      const color = ["#087f8c", "#b7791f", "#315fbd", "#b83257", "#28724f"][index % 5];

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("opacity", "0.62");
      svg.appendChild(path);
    });
  }

  function findNode(operation, id) {
    return []
      .concat(operation.inputs, operation.references, operation.mint, operation.outputs)
      .find((node) => node.id === id);
  }

  function renderInspector(operation) {
    if (!state.selected) {
      el.inspectorHint.textContent = "Select a transaction object or validator.";
      el.inspectorBody.innerHTML = `
        <p class="inspector-copy">This operation touches ${operation.validators.length} validators. Start with the validator badges below or click a node in the transaction shape.</p>
        <div class="badge-row">
          ${operation.validators
            .map((id) => `<button class="badge" type="button" data-inspector-validator="${escapeHtml(id)}">${escapeHtml(model.validators[id].label)}</button>`)
            .join("")}
        </div>
      `;
      el.inspectorBody.querySelectorAll("[data-inspector-validator]").forEach((button) => {
        button.addEventListener("click", () => {
          state.selected = { type: "validator", id: button.dataset.inspectorValidator };
          render();
        });
      });
      return;
    }

    if (state.selected.type === "validator") {
      const validator = model.validators[state.selected.id];
      el.inspectorHint.textContent = "Validator role";
      el.inspectorBody.innerHTML = `
        <h4 class="inspector-title">${escapeHtml(validator.label)}</h4>
        <p class="inspector-copy">${escapeHtml(validator.role)}</p>
        <a class="file-link" href="../../${escapeHtml(validator.file)}">${escapeHtml(validator.file)}</a>
      `;
      return;
    }

    const node = findNode(operation, state.selected.id);
    el.inspectorHint.textContent = `${state.selected.kind} object`;
    el.inspectorBody.innerHTML = `
      <h4 class="inspector-title">${escapeHtml(node.label)}</h4>
      <p class="inspector-copy">${escapeHtml(node.detail)}</p>
      <p class="inspector-copy">Operation: <strong>${escapeHtml(operation.title)}</strong></p>
      <div class="badge-row">
        ${operation.validators
          .map((id) => `<button class="badge" type="button" data-inspector-validator="${escapeHtml(id)}">${escapeHtml(model.validators[id].label)}</button>`)
          .join("")}
      </div>
    `;
    el.inspectorBody.querySelectorAll("[data-inspector-validator]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selected = { type: "validator", id: button.dataset.inspectorValidator };
        render();
      });
    });
  }

  function renderLifecycle(operation) {
    if (!operation.activeLifecycle) {
      el.lifecycleTitle.textContent = "This operation is a creation or local registry action.";
      el.lifecyclePanel.innerHTML = '<p class="inspector-copy">No global IBC state machine transition is selected for this operation.</p>';
      return;
    }

    const lifecycle = model.lifecycles[operation.activeLifecycle.kind];
    el.lifecycleTitle.textContent = lifecycle.title;
    el.lifecyclePanel.innerHTML = `
      <div class="state-track">
        ${lifecycle.transitions
          .map((transition) => {
            const active = transition.from === operation.activeLifecycle.from && transition.to === operation.activeLifecycle.to;
            return `
              <div class="state-row">
                <div class="state-pill ${active ? "active" : ""}">${escapeHtml(transition.from)}</div>
                <div>
                  <div class="transition-line"></div>
                  <span class="transition-label">${escapeHtml(transition.label)}</span>
                </div>
                <div class="state-pill ${active ? "active" : ""}">${escapeHtml(transition.to)}</div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderLists(operation) {
    el.choreographyList.innerHTML = operation.choreography.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    el.hostKeyList.innerHTML = operation.hostState.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join("");
    el.invariantList.innerHTML = operation.invariants.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  }

  function renderSummary(operation) {
    el.operationPhase.textContent = phaseLabel(operation.phase);
    el.operationTitle.textContent = operation.title;
    el.operationSummary.textContent = operation.summary;
    el.validatorCount.textContent = operation.validators.length;
    el.inputCount.textContent = operation.inputs.length + operation.references.length;
    el.hostKeyCount.textContent = operation.hostState.length;
  }

  function render() {
    const operations = filteredOperations();
    if (operations.length > 0 && !operations.some((operation) => operation.id === state.operationId)) {
      state.operationId = operations[0].id;
      state.selected = null;
    }

    const operation = currentOperation();
    renderPhaseTabs();
    renderOperationList();
    renderSummary(operation);
    renderTransaction(operation);
    renderInspector(operation);
    renderLifecycle(operation);
    renderLists(operation);
  }

  el.operationSearch.addEventListener("input", (event) => {
    state.query = event.target.value;
    const operations = filteredOperations();
    if (operations.length > 0) {
      state.operationId = operations[0].id;
      state.selected = null;
    }
    render();
  });

  el.replayButton.addEventListener("click", () => {
    el.transactionCanvas.classList.remove("pulse");
    requestAnimationFrame(() => {
      el.transactionCanvas.classList.add("pulse");
      setTimeout(() => el.transactionCanvas.classList.remove("pulse"), 800);
    });
  });

  window.addEventListener("resize", () => drawConnectors(currentOperation()));
  el.transactionCanvas.addEventListener("scroll", () => drawConnectors(currentOperation()));

  render();
})();
