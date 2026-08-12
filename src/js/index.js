// Hathor-side precision is per token, read from TOKENS[...][31].decimals — see
// app/config/tokens.ts. It is deliberately NOT a constant here: it differs from
// the token's EVM decimals (USDC is 6 on Arbitrum, 2 on Hathor), and a future
// token with a different precision must work by config alone.

// truncateMiddle and validateHathorAddress now come from
// app/composition/legacy-bridge.ts.
// Do not redeclare them here: a top-level declaration in this classic script
// would shadow the window property and silently win.

// Every mutable global that used to be declared here is now a slice of the
// typed store in app/application/state, exposed back under its original name by
// the accessors in legacy-bridge.ts (see STATE_ALIASES).
//
// So `config = null` below is still a plain assignment, but it now *is* a store
// mutation that the new code can observe. Do not redeclare any of these: a
// top-level declaration in this classic script shadows the window accessor and
// the two halves silently stop sharing state.
//
// isTestnet likewise comes from resolveDeployment(). The old
// href.includes("testnet") matched the word anywhere in the URL — a host or path
// containing it silently switched the whole app to testnet contract addresses.
$(document).ready(function () {
  new ClipboardJS(".copy");
  $('[data-toggle="tooltip"]').tooltip();
  $(".selectpicker").selectpicker();

  if (isTestnet) {
    $("#title").text("Hathor Testnet bridge with Ethereum Sepolia");
    $("#network-navlink").text("Use Mainnet");
    $("#network-navlink").attr("href", "./index.html");
  } else {
    $("#network-navlink").text("Use Testnet");
    $("#network-navlink").attr("href", "./index.html?testnet");
  }
  if (
    !/chrom(e|ium)/.test(navigator.userAgent.toLowerCase()) &&
    navigator.userAgent.indexOf("Firefox") == -1
  ) {
    alert(
      "This site will only work correctly under chrome, chromium or firefox"
    );
  }

  $("#logIn").attr("onclick", "onLogInClick()");

  // Both transfer forms, the token bridge list, the info panel and the history
  // tables are components now (app/adapters/driving/ui/components), mounted from
  // app/composition/ui.ts before this ready block runs.
  //
  // Wallet discovery (EIP-6963) is the adapter's; it starts listening when the
  // module graph loads, which is also before this runs.
  autoConnectWallet();
});

/**
 * Reconnects the wallet used last, if it is still installed.
 *
 * The polling loop this replaces asked a mutable array every 100ms, ten times,
 * and gave up silently — so a wallet that injected late left the page looking
 * disconnected for no stated reason. Discovery now resolves the wait itself.
 */
async function autoConnectWallet() {
  const reconnected = await window.__useCases.reconnectEvmWallet();
  if (reconnected) {
    await onWalletConnected(reconnected.wallet, reconnected.connection);
  }
}

async function connectWallet(wallet) {
  try {
    const connection = await window.__useCases.connectEvmWallet(wallet.rdns);
    await onWalletConnected(wallet, connection);
    $('#myModal').modal('hide');
  } catch (error) {
    console.error(`Connection failed for ${wallet.name}:`, error);
    onMetaMaskConnectionError({ message: `Connection failed: ${error.message}` });
  }
}

/**
 * Adopts a connection: builds the web3 instance the legacy code reads, brings the
 * page up to date, and subscribes to the provider's own events.
 */
async function onWalletConnected(wallet, connection) {
  window.web3 = new Web3(connection.provider);
  await updateCallback(connection.chainId, connection.accounts);

  const events = window.__useCases.walletEvents(wallet.rdns);
  if (!events) return;

  events.onChainChanged((newChain) => {
    updateNetwork(newChain);
    window.__ui.history.showTab('evm');
  });
  events.onAccountsChanged((newAddresses) => {
    if (newAddresses.length === 0) {
      onMetaMaskConnectionError({ message: "Wallet disconnected. Please connect again." });
    } else {
      // Straight from storage, so the table stops showing the previous
      // account's transfers before the next poll resolves the new one's.
      updateAddress(newAddresses).then(() => window.__ui.history.showStored());
    }
  });
  events.onDisconnect((error) => {
    console.error("Wallet disconnected:", error);
    onMetaMaskConnectionError({ message: "Wallet connection lost. Please reload the page and connect again." });
  });
}

// The history tables, their pagination and claiming are a component now:
// app/adapters/driving/ui/components/transfer-history.component.ts. It owns the
// resolved transfers, so a claim's parameters never travel through the DOM.

// END CLAIMS

function onDisconnectEvmClick() {
  window.__useCases.forgetEvmWallet();
  // The original left the poller running against a wallet that was gone.
  window.__ui.history.stop();
  $("#logIn").show();
  $("#transferTab").addClass("disabled");
  $(".wallet-status").hide();
  window.__ui.crossForm.setEnabled(false);
  tokenContract = null;
  allowTokensContract = null;
  bridgeContract = null;
  config = null;
  address = "";
}

function onMetaMaskConnectionError(err) {
  console.log(err);
  window.__useCases.forgetEvmWallet();
  window.__ui.history.stop();
  showModal("Connect wallet", `<p>${err.message}</p>`);
  $("#logIn").attr("onclick", "onLogInClick()");
  $("#logIn").text("Connect wallet");
  $("#logIn").show();
  $("#transferTab").addClass("disabled");
  $(".wallet-status").hide();
  $("#address").text("0x00000...");
  window.__ui.crossForm.setEnabled(false);
  tokenContract = null;
  allowTokensContract = null;
  bridgeContract = null;
  config = null;
  address = "";
}

function showModal(title, message) {
  $("#myModal .modal-title").html(title);
  const messageContent = $("#modal-message-content");
  const walletList = $("#wallet-list");

  if (message) {
    messageContent.html(message).show();
    walletList.hide();
  } else {
    messageContent.empty().hide();
    walletList.show();
  }
  $("#myModal").modal("show");
}

function onMetaMaskConnectionSuccess() {
  window.__ui.crossForm.setEnabled(true);
}

async function updateAddress(newAddresses) {
  address = newAddresses[0];
  $('#address').text(truncateMiddle(address));
  $("#evmNetwork").text(isTestnet ? "Sepolia" : "Arbitrum One");
  $("#logIn").hide();
  $("#transferTab").removeClass("disabled");
  $(".wallet-status.indicator").css('display', 'flex');

  if (config) {
    window.__ui.crossForm.populateTokens();
  }

  return Promise.resolve(address);
}

async function updateCallback(chainId, accounts) {
  return updateNetwork(chainId)
    .then(() => updateAddress(accounts))
    .then(() => window.__ui.history.showStored())
    // Starting the poll loads the history too: its first tick fires at once.
    .then(() => window.__ui.history.start());
}

async function updateNetworkConfig(config) {
  $(".fromNetwork").text(config.name);
  // $(".indicator span").html(config.name);
  $(".indicator").removeClass("btn-outline-danger");
  $(".indicator").addClass("btn-outline-success");
  $(".toNetwork").text(config.crossToNetwork.name);
  window.__ui.crossForm.populateTokens();
}

async function updateNetwork(newNetwork) {

  console.log(`Updating network to ${newNetwork}...`);

  window.__ui.toast.hide("success");
  try {
    newNetwork = parseInt(newNetwork);
    if (config && config.networkId == newNetwork) return;

    config = null;
    if (isTestnet) {
      switch (newNetwork) {
        case 11155111:
          config = SEPOLIA_CONFIG;
          break;
      }
    } else {
      switch (newNetwork) {
        case 42161:
          config = ETH_CONFIG;
          break;
      }
    }
    if (config == null) {
      $(".fromNetwork").text("From Network");
      $(".indicator span").html("Unknown Network");
      $(".indicator").removeClass("btn-outline-success");
      $(".indicator").addClass("btn-outline-danger");
      $(".toNetwork").text("To Network");
      $("#willReceiveToken").html("");
      throw new Error(
        `Wrong Network.<br /> Please connect your wallet to <b>${isTestnet ? "Sepolia" : "Arbitrum One"
        }</b>`
      );
    }
    allowTokensContract = new web3.eth.Contract(
      ALLOW_TOKENS_ABI,
      config.allowTokens
    );
    bridgeContract = new web3.eth.Contract(BRIDGE_ABI, config.bridge);
    federationContract = new web3.eth.Contract(
      FEDERATION_ABI,
      config.federation
    );

    $("#myModal").modal("hide");
    await updateNetworkConfig(config);

    onMetaMaskConnectionSuccess();

    // Idempotent: the history component ignores this while already polling,
    // where the original left the old interval running and doubled the request
    // rate on every network switch.
    window.__ui.history.start();

  } catch (err) {
    onMetaMaskConnectionError(err);
    throw err;
  }
}

// The HTR→ARB form and the Hathor wallet button are one component now:
// app/adapters/driving/ui/components/hathor-transfer-form.component.ts. It
// announces what the rest of this page still has to react to; see the listeners
// at the bottom of this file.

// Network configs, TOKENS and the contract ABIs are now built in
// app/config/{networks,tokens}.ts and app/adapters/driven/evm/abis.ts, and
// published onto window by app/composition/legacy-bridge.ts.
//
// They must NOT be redeclared here: a top-level declaration in this classic
// script creates a script-scope binding that shadows the window property.
//
// The ABIs are static imports now, so the old fire-and-forget loadAbi() fetches
// (and the race where updateNetwork could build a contract with an undefined
// ABI) are gone.
