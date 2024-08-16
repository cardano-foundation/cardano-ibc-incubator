import { render } from "preact";
import { useState } from "preact/hooks";

import { NetworkName } from "../../lib/CIP30";
import * as State from "./State";

import OverviewPage from "./pages/Overview";
import AccountsPage from "./pages/Accounts";
import NetworkPage from "./pages/Network";
import LogsPage from "./pages/Logs";

const BODY_CLASSES = "column gap-xxl gap-no-propagate align-stretch";
document.body.className = BODY_CLASSES;
render(<App />, document.body);

function App() {
  let [navActive, setNavActive] = useState("Overview");

  const pages = [
    ["Overview", <OverviewPage />],
    ["Accounts", <AccountsPage />],
    ["Network", <NetworkPage />],
    ["Logs", <LogsPage />],
  ] as const;

  const navItems = pages.map(([name, _]) => name);

  const pageStyle = {
    class: "column",
  };

  return (
    <>
      <Header
        navItems={navItems}
        navActive={navActive}
        navigate={setNavActive}
      />
      {pages.map((item) => {
        let [name, page] = item;
        let pageStyle_ = { ...pageStyle };
        if (navActive != name) {
          pageStyle_.class += " display-none";
        }
        return <div {...pageStyle_}>{page}</div>;
      })}
    </>
  );
}

function Header({
  navItems,
  navActive,
  navigate,
}: {
  navItems: string[];
  navActive: string;
  navigate: (arg: string) => void;
}) {
  let networkActive = State.networkActive.value;

  const logo = (
    <div class="row gap-m">
      <img src="static/logo.png" height="64" />
      <div class="column gap-none color-accent">
        <div class="L2">Cardano</div>
        <div class="row gap-s L4 caps" style={{ letterSpacing: "0.18ch" }}>
          <span class="color-action">Dev</span> Wallet
        </div>
      </div>
    </div>
  );

  const networkSelector = (
    <div class="column gap-none">
      {[NetworkName.Mainnet, NetworkName.Preprod, NetworkName.Preview].map(
        (network) => (
          <button
            class={
              "button" + (network == networkActive ? "" : " -secondary")
            }
            onClick={() => State.networkActiveSet(network)}
          >
            {network}
          </button>
        ),
      )}
    </div>
  );

  const nav = <nav class="row gap-xl align-center">
    {navItems.map((nav) => (
      <a
        class={"nav-item " + (navActive == nav ? "-active" : "")}
        onClick={() => navigate(nav)}
      >
        {nav}
      </a>
    ))}
  </nav>;

  return (
    <div class="row gap-xl justify-space align-center">
      <div class="row align-center gap-l">
        {logo}
        {networkSelector}
      </div>
      {nav}
    </div>
  );
}
