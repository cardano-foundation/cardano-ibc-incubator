{
  inputs = {
    nixpkgs.url = "nixpkgs"; # Resolves to github:NixOS/nixpkgs
    # Helpers for system-specific outputs
    flake-utils.url = "github:numtide/flake-utils";
    plutip.url = "github:mlabs-haskell/plutip";
    ogmios-nixos = {
      url = "github:mlabs-haskell/ogmios-nixos/78e829e9ebd50c5891024dcd1004c2ac51facd80";
    };
    kupo-nixos = {
      url = "github:mlabs-haskell/kupo-nixos/df5aaccfcec63016e3d9e10b70ef8152026d7bc3";
    };
    cardano-cli.url = "github:intersectmbo/cardano-node/8.7.3";
  };
  outputs =
    { self
    , nixpkgs
    , flake-utils
    , plutip
    , ogmios-nixos
    , kupo-nixos
    , cardano-cli
    , ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };
        plutipBin = plutip.apps.${system}."plutip-core:exe:local-cluster".program;
        ogmiosBin = ogmios-nixos.apps.${system}."ogmios:exe:ogmios".program;
        kupoBin = kupo-nixos.packages.${system}.kupo.exePath;
        cardanoCliBin = cardano-cli.apps.${system}.cardano-cli.program;

        mprocsBin = "${pkgs.mprocs}/bin/mprocs";
        jqBin = "${pkgs.jq}/bin/jq";

        scriptCommon = ''
          set -euo pipefail
          sleep 1;

          echo -e "Waiting for cluster info ..";
          cluster_info="local-cluster-info.json";
          while [ ! -f $cluster_info ]; do sleep 1; done;

          echo -e "Waiting for socket ..";
          do=true;
          while $do || [ ! -S $socket ]; do
            do=false;
            socket=$(jq .ciNodeSocket $cluster_info --raw-output)
            sleep 1;
          done
          echo "Socket found: " $socket "       "

          config=''${socket/node.socket/node.config}


            if [ -f .env ]; then
              source ./.env
            else
              echo "Create a .env file to configure this script."
              echo "See env.example to see available options".
            fi;

            if [ -z ''${OGMIOS_PORT+x} ]; then
              OGMIOS_PORT=1337
            fi;

            if [ -z ''${KUPO_PORT+x} ]; then
              KUPO_PORT=1442
            fi;
        '';
      in
      rec {
        packages.startKupo = pkgs.writeShellScript "startKupo" ''
          ${scriptCommon}

          ${kupoBin} \
            --node-socket $socket \
            --node-config $config \
            --match '*' \
            --match '*/*' \
            --since origin \
            --in-memory \
            --host 0.0.0.0 \
            --port $KUPO_PORT
        '';
        packages.startOgmios = pkgs.writeShellScript "startOgmios" ''
          ${scriptCommon}

          ${ogmiosBin} \
            --node-socket $socket \
            --node-config $config \
            --host 0.0.0.0 \
            --port $OGMIOS_PORT
        '';
        packages.startPlutip = pkgs.writeShellScript "startPlutip" ''
          rm local-cluster-info.json
          rm -rf wallets
          ${plutipBin} --wallet-dir wallets
        '';
        packages.showInfo = pkgs.writeShellScript "showInfo" ''
          ${scriptCommon}
          echo
          echo Ogmios:
          ${ogmiosBin} --version
          echo Listening on port $OGMIOS_PORT
          echo
          echo Kupo:
          ${kupoBin} --version
          echo Listening on port $KUPO_PORT
          echo
        '';
        packages.fundAda = pkgs.writeShellScript "fundAda" ''
          echo
          echo "Funding UTxO #1"
          ${packages.fundAdaBase}
          echo
          echo
          echo "Funding UTxO #2"
          ${packages.fundAdaBase}
          echo
          echo
          echo "Funding UTxO #3"
          ${packages.fundAdaBase}
          echo
          echo
        '';
        packages.fundAdaBase = pkgs.writeShellScript "fundAdaBase" ''
          ${scriptCommon}
          export CARDANO_NODE_SOCKET_PATH=$socket

          mkdir -p ./txns

          if [ -z ''${ADDRESS_TO_FUND+x} ]; then
            echo "Please set ADDRESS_TO_FUND in .env"
            exit -1;
          fi;

          if [ -z ''${FUND_ADA+x} ]; then
            echo "Please set FUND_ADA in .env"
            exit -1;
          fi;

          if [ -z ''${CARDANO_NETWORK+x} ]; then
            echo "Please set CARDANO_NETWORK in .env"
            exit -1;
          fi;

          case $CARDANO_NETWORK in
            mainnet)
              export CARDANO_NODE_NETWORK_ID=mainnet;
              ;;
            preprod)
              export CARDANO_NODE_NETWORK_ID=1;
              ;;
            preview)
              export CARDANO_NODE_NETWORK_ID=2;
              ;;
            *)
              echo "CARDANO_NETWORK is set to an invalid value:" $CARDANO_NETWORK
              echo "Allowed values: mainnet, preprod, preview";
              exit -1;
          esac;

          while [ ! -d wallets ]; do sleep 1; done

          do=true;
          while $do || [ ! -f $vkey ]; do
            do=false;
            vkey="wallets/$(ls wallets | grep verification)"
            sleep 1;
          done;

          address=$( \
              ${cardanoCliBin} latest \
              address \
              build \
              --payment-verification-key-file \
              $vkey \
              --mainnet \
          )

          echo
          echo Source Address: $address

          txn=$( \
            ${cardanoCliBin} \
              query \
              utxo \
              --address $address \
              --mainnet \
            | head -n 3 | tail -n 1 \
          )

          txHash=$(echo $txn | cut -d' ' -f 1)
          txIdx=$(echo $txn | cut -d' ' -f 2)

          echo Source UTxO: "$txHash#$txIdx"


          fundAddress=$ADDRESS_TO_FUND
          fundLovelace=$(echo "$FUND_ADA*1000000"|bc)

          echo
          echo "Sending $FUND_ADA ADA to $ADDRESS_TO_FUND"
          echo

          ${cardanoCliBin} \
            latest \
            transaction \
            build \
            --mainnet \
            --tx-in "$txHash#$txIdx" \
            --tx-out $fundAddress+$fundLovelace \
            --change-address $address \
            --out-file ./txns/txn-fund-ada.json;

          ${cardanoCliBin} \
            latest \
            transaction \
            sign \
            --tx-file ./txns/txn-fund-ada.json \
            --signing-key-file ./wallets/signing-key*.skey \
            --mainnet \
            --out-file ./txns/txn-fund-ada-signed.json;

          ${cardanoCliBin} \
            latest \
            transaction \
            submit \
            --tx-file txns/txn-fund-ada-signed.json \
            --mainnet;
        '';
        packages.mprocsCfg = pkgs.writeText "mprocs.yaml" ''
          procs:
            plutip:
              cmd: ["${self.packages.${system}.startPlutip}"]
            ogmios:
              cmd: ["${self.packages.${system}.startOgmios}"]
            kupo:
              cmd: ["${self.packages.${system}.startKupo}"]
            fundAda:
              cmd: ["${self.packages.${system}.fundAda}"]
            info:
              cmd: ["${self.packages.${system}.showInfo}"]
        '';
        packages.cardano-cli = cardano-cli.packages.${system}.cardano-cli;
        packages.default = pkgs.writeShellScript "startAll" ''
          ${mprocsBin} --config ${self.packages.${system}.mprocsCfg}
        '';
        apps.default = {
          type = "app";
          program = "${self.packages.${system}.default}";
        };
      }
    );
  nixConfig = {
    extra-substituters = [
      "https://cache.iog.io"
      "https://public-plutonomicon.cachix.org"
    ];
    extra-trusted-public-keys = [
      "hydra.iohk.io:f/Ea+s+dFdN+3Y/G+FDgSq+a5NEWhJGzdjvKNGv0/EQ="
      "plutonomicon.cachix.org-1:3AKJMhCLn32gri1drGuaZmFrmnue+KkKrhhubQk/CWc="
    ];
    allow-import-from-derivation = true;
  };
}

