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

  disableInputs(true);
  disableApproveCross({
    approvalDisable: true,
    doNotAskDisabled: true,
    crossDisabled: true,
  });

  $("#logIn").attr("onclick", "onLogInClick()");

  $("#tokenAddress").change(function (event) {
    cleanAlertSuccess();
    let token = TOKENS.find(
      (element) => element.token == event.currentTarget.value
    );
    if (token) {
      tokenContract = new web3.eth.Contract(ERC20_ABI, token[config.networkId].address);
      tokenContract.methods.balanceOf(address).call().then(balance => {
        const decimals = token[config.networkId].decimals;
        const formatted = new BigNumber(balance).shiftedBy(-decimals).toFormat(4, BigNumber.ROUND_DOWN);
        $('#evmTokenBalance').text(`${formatted} ${token[config.networkId].symbol}`);
      }).catch(() => $('#evmTokenBalance').text('—'));

      $(".selectedToken").html(token[config.networkId].symbol);
      let html = `<a target="_blank" href="${config.crossToNetwork.explorer
        }/token_detail/${token[
          config.crossToNetwork.networkId
        ].pureHtrAddress.toLowerCase()}">`;
      html += `\n   <span><img src="${token.icon}" class="token-logo"></span>${token[config.crossToNetwork.networkId].symbol
        }`;
      html += `\n </a>`;
      $("#willReceiveToken").html(html);
      $("#willReceive-copy").show();
      $("#willReceive-copy").attr(
        "data-clipboard-text",
        token[config.crossToNetwork.networkId].address
      );

      // Switching to a token Hathor represents more coarsely has to re-cap
      // whatever is already typed.
      clampCrossAmountToHathorPrecision();

      // The info panel is a component now; refreshing it also refreshes the
      // fee and the limits in the store, which isAmountOk reads.
      window.__ui.infoPanel.refresh(token[config.networkId].address).then(() => {
        isAmountOk();
        if ($("#amount").val()) {
          checkAllowance();
        }
      });
    } else {
      $(".selectedToken").html("");
      $("#willReceive").html("");
      $("#willReceive-copy").hide();
      fee = 0;
      feePercentage = 0;
      if ($("#amount").val()) {
        isAmountOk();
      } else {
        $("#serviceFee").html("0.000000");
        $("#totalCost").html("0.000000");
      }
    }
  });

  // Clamp on 'input' rather than 'keypress' so pasting is covered too. It fires
  // before 'keyup', so isAmountOk below already sees the clamped value.
  $("#amount").on("input", function () {
    clampCrossAmountToHathorPrecision();
    isAmountOk();
  });
  $("#amount").keyup(function (event) {
    isAmountOk();
    if (event.key === "Enter") {
      checkAllowance();
    }
  });
  $("#amount").focusout(checkAllowance);
  $("#amount").keypress(function (event) {
    if (event.key !== "." && (event.key < "0" || event.key > "9")) {
      return false;
    }
  });
  $("#crossForm").on("submit", function (e) {
    e.preventDefault();
    crossToken();
  });
  $("#approve").on("click", function (e) {
    e.preventDefault();
    approveSpend();
  });

  $("#hathorAddress").keyup(function (event) {
    handleHathorAddressChange();
  });

  $("#changeNetwork").on("click", function () {
    showModal(
      "Operation not Available",
      "This operation is unavailable until Celo Donut Fork."
    );
  });
  // The token bridge list is a component now (app/adapters/driving/ui/components),
  // mounted from app/composition/ui.ts before this ready block runs.
  // Wallet discovery (EIP-6963) is the adapter's; it starts listening when the
  // module graph loads, which is before this ready block runs.
  autoConnectWallet();

  // ---- HTR→ARB direction: event wiring ----
  $('#directionToggle').on('change', 'input[type=radio]', function () {
    const dir = $(this).val();
    if (dir === 'arb-to-htr') {
      $('#crossForm').show();
      $('#htrToArbForm').hide();
      if (window.HathorWallet && window.HathorWallet.isConnected()) {
        $('#hathorAddress').val(window.HathorWallet.getAddress());
        handleHathorAddressChange();
      }
    } else {
      $('#crossForm').hide();
      $('#htrToArbForm').show();
    }
  });

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
      checkAllowance();
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

function handleHathorAddressChange() {
  const hathorAddress = $("#hathorAddress").val();
  if (hathorAddress) {
    if (validateHathorAddress(hathorAddress)) {
      $("#hathorAddress").removeClass("is-invalid");
      $("#hathorAddress").addClass("is-valid");
    } else {
      $("#hathorAddress").removeClass("is-valid");
      $("#hathorAddress").addClass("is-invalid");
    }
  } else {
    $("#hathorAddress").removeClass("is-valid");
    $("#hathorAddress").removeClass("is-invalid");
  }
}

// The history tables, their pagination and claiming are a component now:
// app/adapters/driving/ui/components/transfer-history.component.ts. It owns the
// resolved transfers, so a claim's parameters never travel through the DOM.

// END CLAIMS

async function getMaxBalance(event) {
  //TODO understand if we need to change contract
  if (event)
    event.preventDefault();
  let tokenToCross = $('#tokenAddress').val();
  let token = TOKENS.find(element => element.token == tokenToCross);
  if (!token) {
    return;
  }
  const tokenAddress = token[config.networkId].address;
  tokenContract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
  const decimals = token[config.networkId].decimals;
  return retry3Times(tokenContract.methods.balanceOf(address).call)
    .then(async (balance) => {
      const balanceBN = new BigNumber(balance).shiftedBy(-decimals);
      const maxWithdrawInWei = await retry3Times(allowTokensContract.methods.calcMaxWithdraw(tokenAddress).call);
      const maxWithdraw = new BigNumber(web3.utils.fromWei(maxWithdrawInWei, 'ether'));

      // Computed at the token's EVM precision, then capped at what Hathor can
      // represent — both steps truncate down, so Max never exceeds the balance.
      $('#amount').val(window.__domain.maxTransferable(balanceBN, maxWithdraw, fee, decimals));
      clampCrossAmountToHathorPrecision();
      $('#amount').keyup();
    });
}

/**
 * Step one of the ARB→HTR flow.
 *
 * The button state is all that is left here: the amount arithmetic, the fee
 * gross-up, the gas price and the wait for the receipt are the approveSpend use
 * case's, which is also what publishes a revert as an error instead of a
 * silently successful approval.
 */
async function approveSpend() {
  const approveButton = $("#approve");
  const originalButtonText = approveButton.html();
  approveButton.prop("disabled", true).html('<i class="fas fa-spinner fa-spin"></i> Approving...');

  if ($("#amount").hasClass("is-invalid")) {
    crossTokenError("Invalid Amount");
    approveButton.html(originalButtonText);
    return;
  }

  try {
    await window.__useCases.approveSpend({
      tokenKey: $("#tokenAddress").val(),
      amount: $("#amount").val(),
      unlimited: $("#doNotAskAgain").prop("checked"),
    });

    disableApproveCross({
      approvalDisable: true,
      doNotAskDisabled: true,
      crossDisabled: false,
    });
    approveButton.html(originalButtonText);
  } catch (err) {
    console.error(err);
    crossTokenError(`Couldn't approve amount. ${err.message}`);
    disableApproveCross({
      approvalDisable: false, // Re-enable on error
      doNotAskDisabled: false,
      crossDisabled: true,
    });
    approveButton.html(originalButtonText); // Restore button text only on error
  }
}

/**
 * Step two of the ARB→HTR flow.
 *
 * What remains is the form and the alerts. The balance check, the daily-limit
 * check, the destination validation, the fee gross-up and the history record all
 * belong to the crossToken use case now — including the limit comparison, which
 * was previously unreachable for tokens whose EVM precision is not 18.
 */
async function crossToken() {
  const convertButton = $("#deposit");
  const originalButtonText = convertButton.html();
  convertButton.prop("disabled", true).html('<i class="fas fa-spinner fa-spin"></i> Converting...');

  try {
    cleanAlertError();
    cleanAlertSuccess();

    if ($("#amount").hasClass("is-invalid")) {
      throw new Error("Invalid Amount");
    }

    disableInputs(true);

    const { receives } = await window.__useCases.crossToken({
      tokenKey: $("#tokenAddress").val(),
      amount: $("#amount").val(),
      hathorAddress: $("#hathorAddress").val(),
    });

    $("#confirmationTime").text(config.confirmationTime);
    $("#receive").text(receives);
    window.__ui.toast.show("success");

    window.__ui.history.showStored();
    window.__ui.history.showTab('evm');
    disableApproveCross({
      approvalDisable: true,
      doNotAskDisabled: true,
      crossDisabled: true,
    });
  } catch (err) {
    console.error(err);
    crossTokenError(`Couldn't cross the tokens. ${err.message}`);
  } finally {
    convertButton.prop("disabled", false).html(originalButtonText);
    disableInputs(false);
  }
}

function cleanAlertSuccess() {
  window.__ui.toast.hide("success");
}

function cleanAlertError() {
  $("#alert-danger-text").html("");
  window.__ui.toast.hide("alert-danger");
}

function crossTokenError(err) {
  $("#alert-danger-text").html(err);
  window.__ui.toast.show("alert-danger");
  // $('#cross').prop('disabled', false);
  $("#deposit").prop("disabled", false);

  disableInputs(false);
}

async function checkAllowance() {
  cleanAlertSuccess();
  let amount = $("#amount").val();
  if (amount == "") {
    markInvalidAmount("Invalid amount");
    return;
  }
  let parsedAmount = new BigNumber(amount);
  if (parsedAmount <= 0) {
    markInvalidAmount("Must be bigger than 0");
    return;
  }
  $("#secondsPerBlock").text(config.secondsPerBlock);
  $("#amount").removeClass("ok");
  const { totalCost } = window.__domain.quote(amount, fee);

  let tokenToCross = $("#tokenAddress").val();
  let token = TOKENS.find((element) => element.token == tokenToCross);
  const tokenAddress = token[config.networkId].address;
  tokenContract = new web3.eth.Contract(ERC20_ABI, tokenAddress);

  let allowance = await retry3Times(
    tokenContract.methods.allowance(address, bridgeContract.options.address)
      .call
  );
  allowance = web3.utils.fromWei(allowance);
  let allowanceBN = new BigNumber(allowance);

  if (totalCost.lte(allowanceBN)) {
    $(".approve-deposit").hide();
    // straight to convert
    disableApproveCross({
      approvalDisable: true,
      doNotAskDisabled: true,
      crossDisabled: false,
    });
  } else {
    // user must first approve amount
    disableApproveCross({
      approvalDisable: false,
      doNotAskDisabled: false,
      crossDisabled: true,
    });
    $(".approve-deposit").show();
  }
}

/**
 * Hathor-side precision for the token selected in the ARB→HTR form, or null
 * when the selection is not bridgeable to Hathor.
 *
 * Returning null matters: an unbridgeable token carries the placeholder
 * `decimals: 0`, and clamping the input to zero decimals would make it
 * impossible to type a fractional amount at all.
 */
function crossFormHathorDecimals() {
  const selectedKey = $("#tokenAddress").val();
  if (!selectedKey) return null;
  const token = TOKENS.find(t => t.token === selectedKey);
  if (!token || !token[31] || !token[31].pureHtrAddress) return null;
  return token[31].decimals;
}

/**
 * Cap #amount at the precision Hathor can actually represent.
 *
 * The destination chain truncates anything finer, so accepting it would just
 * mislead the user about what arrives. Note this constrains the *input* only —
 * approveSpend and crossToken still scale the amount by the token's EVM
 * decimals, which is what the ERC20 and bridge contracts expect.
 */
function clampCrossAmountToHathorPrecision() {
  const decimals = crossFormHathorDecimals();
  if (decimals === null) return;

  const input = $("#amount");
  const current = input.val();
  const clamped = window.__domain.clampDecimals(current, decimals);
  if (clamped !== current) input.val(clamped);
}

async function isAmountOk() {
  cleanAlertSuccess();
  const amount = $("#amount").val();

  // Always calculate and display the fee and total cost
  const { totalCost, serviceFee } = window.__domain.quote(amount, fee);
  $("#serviceFee").html(window.__domain.formatQuoteValue(serviceFee));
  $("#totalCost").html(window.__domain.formatQuoteValue(totalCost));

  const rejection = window.__domain.validateAmount(amount, totalCost, {
    min: minTokensAllowed,
    max: maxTokensAllowed,
    feeRate: fee,
  });

  if (rejection) {
    markInvalidAmount(window.__domain.rejectionMessage(rejection));
    disableApproveCross({ approvalDisable: true, doNotAskDisabled: true, crossDisabled: true });
    return;
  }

  $(".amount .invalid-feedback").hide();
  $("#amount").removeClass("is-invalid");
  $("#amount").addClass("ok");
}

function markInvalidAmount(errorDescription) {
  let invalidAmount = $(".amount .invalid-feedback");
  invalidAmount.html(errorDescription);
  invalidAmount.show();
  $("#amount").addClass("is-invalid");
  $("#amount").prop("disabled", false);
  $("#amount").removeClass("ok");
}

function onDisconnectEvmClick() {
  window.__useCases.forgetEvmWallet();
  // The original left the poller running against a wallet that was gone.
  window.__ui.history.stop();
  $("#logIn").show();
  $("#transferTab").addClass("disabled");
  $(".wallet-status").hide();
  disableInputs(true);
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
  disableInputs(true);
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

function disableApproveCross({
  approvalDisable = true,
  doNotAskDisabled = true,
  crossDisabled = true,
}) {
  $("#approve").prop("disabled", approvalDisable);
  $("#doNotAskAgain").prop("disabled", doNotAskDisabled);
  $("#deposit").prop("disabled", crossDisabled);
}

function disableInputs(disable) {
  $("#tokenAddress").prop("disabled", disable);
  $("button[data-id='tokenAddress']").prop("disabled", disable);
  $("#amount").prop("disabled", disable);
  if (disable) {
    $("#max").off("click");
    $("#max").removeAttr("href");
  } else {
    $("#max").on("click", getMaxBalance);
    $("#max").attr("href", "#");
  }
}

function onMetaMaskConnectionSuccess() {
  disableInputs(false);
  disableApproveCross({
    approvalDisable: true,
    doNotAskDisabled: true,
    crossDisabled: true,
  });
}

async function updateAddress(newAddresses) {
  address = newAddresses[0];
  $('#address').text(truncateMiddle(address));
  $("#evmNetwork").text(isTestnet ? "Sepolia" : "Arbitrum One");
  $("#logIn").hide();
  $("#transferTab").removeClass("disabled");
  $(".wallet-status.indicator").css('display', 'flex');

  if (config) {
    await updateTokenAddressDropdown(config.networkId);
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
  $("#confirmations").html(config.confirmations);
  $("#timeToCross").html(config.crossToNetwork.confirmationTime);
  await updateTokenAddressDropdown(config.networkId);
}

async function updateNetwork(newNetwork) {

  console.log(`Updating network to ${newNetwork}...`);

  cleanAlertSuccess();
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

async function updateTokenAddressDropdown(networkId) {
  let selectHtml = "";
  for (let aToken of TOKENS) {
    if (aToken[networkId] != undefined) {
      selectHtml += `\n<option value="${aToken.token}" `;
      selectHtml += `data-content="<span><img src='${aToken.icon}' class='token-logo'></span>${aToken[networkId].symbol}">`;
      selectHtml += `\n</option>`;
    }
  }
  $("#tokenAddress").html(selectHtml);
  $("#tokenAddress").prop("disabled", false);
  $("#tokenAddress").selectpicker("refresh");
  $("#tokenAddress").trigger('change');
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

/**
 * What is left for this half to do when the Hathor form reports something.
 *
 * Both of these belong to components that do not exist yet — the ARB→HTR form
 * owns the destination field, the history table owns the tables and the tab.
 * When they land, these listeners move into them and the events stay as they
 * are.
 */
window.addEventListener('hathorwallet:connected', function (event) {
  const address = event.detail.address;
  if (address && $('#crossForm').is(':visible')) {
    $('#hathorAddress').val(address);
    handleHathorAddressChange();
  }
});


