// Hathor-side precision is per token, read from TOKENS[...][31].decimals — see
// app/config/tokens.ts. It is deliberately NOT a constant here: it differs from
// the token's EVM decimals (USDC is 6 on Arbitrum, 2 on Hathor), and a future
// token with a different precision must work by config alone.

// truncateMiddle, toHathorTxId, matchLocalHathorTxn, Paginator and
// validateHathorAddress now come from app/composition/legacy-bridge.ts.
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
// pagination of active txs table
const numberOfLines = 6;

const requiredVotesToClaim = 4;
// The Read API reports Hathor-side ProposalSigned events but not the threshold
// they are counted against; the federation uses the same size as the EVM side.
const requiredSignaturesToRelay = 4;

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

  $("#claimTokens").click(function () {
    showEvmTxsnTabe();
    location.hash = "";
    location.hash = `#nav-eth-htr-tab`;
  });

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

  $('#nav-htr-eth-tab, #nav-eth-htr-tab').on('shown.bs.tab', function () {
    showActiveAddressTXNs();
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
    showActiveTxnsTab();
  });
  events.onAccountsChanged((newAddresses) => {
    if (newAddresses.length === 0) {
      onMetaMaskConnectionError({ message: "Wallet disconnected. Please connect again." });
    } else {
      checkAllowance();
      updateAddress(newAddresses)
        .then((addr) => updateActiveAddressTXNs(addr))
        .then(() => showActiveAddressTXNs());
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

// CLAIMS

/**
 * Hathor→EVM transfers, as resolved by the load-transfer-history use case.
 *
 * Kept here so the render below can read the claim requests without going
 * through `data-*` attributes. Replaced by component state in the next phase.
 */
let loadedHathorTransfers = [];

async function fillHathorToEvmTxs() {
  if (!address || address === "0x123456789") {
    return;
  }

  // The use case owns what used to be getPendingClaims, resolveClaimStatus,
  // the token lookup, the local-record matching and the persistence.
  const { hathorToEvm, evmToHathor } = await window.__useCases.loadTransferHistory(address);

  // Render from the resolved transfers rather than re-reading storage: only
  // these carry the typed claim request and the amount scale.
  loadedHathorTransfers = hathorToEvm;
  activeAddresseth2HtrTxns = hathorToEvm;
  activeAddresshtr2EthTxns = evmToHathor;

  showActiveAddressTXNs();
}





// resolveGasPrice and waitForReceipt now live in the application layer: the gas
// rule is one function in domain/gas-price.ts fed by the chain port, and the
// receipt wait is confirmTransaction, which also stopped leaking its polling
// interval on the timeout path.

function onLogInClick() {
  const walletList = $("#wallet-list");
  walletList.empty(); // Clear previous list

  const wallets = window.__useCases.discoveredWallets();
  if (wallets.length === 0) {
    showModal("No Wallets Found", "Please install a wallet extension like MetaMask.");
    return;
  }

  wallets.forEach(wallet => {
    const walletItem = $(`
      <li class="list-group-item d-flex justify-content-between align-items-center">
        <div>
          <img src="${wallet.icon}" alt="${wallet.name}" width="30" height="30" class="mr-2">
          ${wallet.name}
        </div>
        <button class="btn btn-primary btn-sm">Connect</button>
      </li>
    `);
    walletItem.find('button').on('click', () => connectWallet(wallet));
    walletList.append(walletItem);
  });

  showModal("Select a Wallet", "");
  $('#myModal .modal-body').show(); // Make sure the body is visible
}

function onPreviousTxnClick() {
  if ($("#nav-eth-htr-tab").attr("class").includes("active")) {
    eth2HtrTablePage -= 1;
  } else {
    htr2EthTablePage -= 1;
  }
  showActiveAddressTXNs();
}

function onNextTxnClick() {
  if ($("#nav-eth-htr-tab").attr("class").includes("active")) {
    eth2HtrTablePage += 1;
  } else {
    htr2EthTablePage += 1;
  }
  showActiveAddressTXNs();
}

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

    updateActiveAddressTXNs(address);
    showActiveTxnsTab();
    showActiveAddressTXNs();
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

// Claim errors used to be written into #claimTab, which is permanently hidden —
// so users never saw them. They now go to the same visible alert the transfer
// flow uses.
function errorClaim(error) {
  $("#alert-danger-text").html(error);
  window.__ui.toast.show("alert-danger");
}

/**
 * Submits a claim and reports the outcome.
 *
 * @param {import('../app/ports/driven/contracts.port').ClaimRequest} claim
 *        The typed request built by the load-transfer-history use case.
 */
async function claimToken(claim) {
  cleanAlertError();
  cleanAlertSuccess();

  try {
    await window.__useCases.claimTransfer(claim);
  } catch (err) {
    // A reverted claim used to look like a successful one: the send promise was
    // awaited and the receipt status never checked, so the row simply never
    // changed and the user was left guessing.
    console.error(err);
    errorClaim(`Couldn't claim the tokens. ${err.message}`);
  } finally {
    startPoolingTxs();
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

/**
 * Reloads both history lists straight from storage.
 *
 * Used when the account changes and the table must stop showing the previous
 * account's transfers before the next poll runs.
 *
 * Storage records carry no claim request — that is resolved against the chain by
 * the load-transfer-history use case. So rows rendered from here show no Claim
 * button until the next poll, which is deliberate: a button built from
 * unresolved data could point at a transfer that was already claimed.
 */
function updateActiveAddressTXNs() {
  activeAddresseth2HtrTxns = TXN_Storage.getAllTxns4Address(
    address,
    config.crossToNetwork.name
  );
  activeAddresshtr2EthTxns = TXN_Storage.getAllTxns4Address(
    address,
    config.name
  );
  // Drop the resolved transfers too, so no stale index can resolve to a claim
  // belonging to a different account.
  loadedHathorTransfers = [];
}

function showActiveTxnsTab() {
  if (config.name.toLowerCase().includes("eth")) {
    showEvmTxsnTabe();
  } else {
    showHtrTxsnTabe();
  }
}

function showEvmTxsnTabe() {
  $("#nav-eth-htr-tab").addClass("active").attr("aria-selected", true);
  $("#nav-eth-htr").addClass("active show");
  $("#nav-htr-eth-tab").removeClass("active").attr("aria-selected", false);
  $("#nav-htr-eth").removeClass("active show");
}

function showHtrTxsnTabe() {
  $("#nav-htr-eth-tab").addClass("active").attr("aria-selected", true);
  $("#nav-htr-eth").addClass("active show");
  $("#nav-eth-htr-tab").attr("aria-selected", false).removeClass("active");
  $("#nav-eth-htr").removeClass("active show");
}

function showActiveAddressTXNs() {

  // Allow rendering Hathor-initiated txns even without EVM wallet/polling
  if (poolingIntervalId === null && !activeAddresseth2HtrTxns.length)
    return;

  if (!activeAddresseth2HtrTxns.length && !activeAddresshtr2EthTxns.length) {
    $("#previousTxnsEmptyTab").css("margin-bottom", "6em").show();
    $("#previousTxnsTab").hide();
    return;
  }

  $("#previousTxnsEmptyTab").css("margin-bottom", "0em").hide();
  $("#previousTxnsTab").show().css("margin-bottom", "6em");
  $("#txn-previous").off().on("click", onPreviousTxnClick);
  $("#txn-next").off().on("click", onNextTxnClick);

  let eth2HtrTable = $("#eth-htr-tbody");
  let htr2EthTable = $("#htr-eth-tbody");

  eth2HtrPaginationObj = Paginator(
    activeAddresseth2HtrTxns,
    eth2HtrTablePage,
    numberOfLines
  );
  let { data: eth2HtrTxns } = eth2HtrPaginationObj;

  htr2EthPaginationObj = Paginator(
    activeAddresshtr2EthTxns,
    htr2EthTablePage,
    numberOfLines
  );
  let { data: htr2EthTxns } = htr2EthPaginationObj;

  const isEthToHtrTabActive = $("#nav-eth-htr-tab").hasClass("active");
  const activePaginationObj = isEthToHtrTabActive ? eth2HtrPaginationObj : htr2EthPaginationObj;

  if (activePaginationObj.total_pages > 1) {
    $(".btn-toolbar").show();
    $("#txn-previous").prop('disabled', activePaginationObj.pre_page === null);
    $("#txn-next").prop('disabled', activePaginationObj.next_page === null);
  } else {
    $(".btn-toolbar").hide();
  }

  let currentNetwork = $(".indicator span").text();


  /**
   * One Hathor-origin row.
   *
   * The markup now comes from app/adapters/driving/ui/templates. The claim
   * request travels as an index into `loadedHathorTransfers` instead of a set of
   * `data-*` attributes that setClaimButtons had to re-parse — an amount used to
   * make a round trip through a string attribute before reaching a contract call.
   */
  const processHtrTxn = (txn, route) => {
    // Identity, because these rows are the very objects the use case returned.
    const claimIndex = txn.claim ? loadedHathorTransfers.indexOf(txn) : -1;
    const action = window.__templates.transferStatusCell(
      txn.status,
      claimIndex >= 0 ? claimIndex : null
    );
    const explorer = route && route.crossToNetwork ? route.crossToNetwork.explorer : null;
    return window.__templates.hathorTransferRow({ ...txn, action }, explorer);
  };

  const processTxn = (txn, config = {}) => {
    const { confirmations, secondsPerBlock, explorer } = config;

    const progress = window.__domain.confirmationProgress({
      transactionBlock: txn.blockNumber,
      currentBlock: currentBlockNumber,
      required: confirmations,
      secondsPerBlock,
    });
    const status = progress.confirmed
      ? `<span> Confirmed</span>`
      : `<span> Pending</span>`;
    const humanTimeToConfirmation = progress.humanTimeRemaining;

    let txnExplorerLink = `${explorer}/tx/${txn.transactionHash}`;
    let shortTxnHash = `${txn.transactionHash.substring(
      0,
      8
    )}...${txn.transactionHash.slice(-8)}`;

    let htmlRow = `<tr class="black">
            <th scope="row"><a href="${txnExplorerLink}">${shortTxnHash}</a></th>
            <td>${txn.blockNumber}</td>
            <td>${window.__templates.formatRowAmount(txn.amount, txn.amountDecimals ?? null, 2)} ${txn.tokenFrom}</td>
            <td>${status} ${humanTimeToConfirmation}</td>
        </tr>`;

    return htmlRow;
  };

  const activeAddressTXNseth2HtrRows = eth2HtrTxns.map((txn) => {
    return processHtrTxn(txn, config);
  });
  const activeAddressTXNshtr2EthRows = htr2EthTxns.map((txn) => {
    return processTxn(txn, config);
  });

  eth2HtrTable.html(activeAddressTXNseth2HtrRows.join());
  htr2EthTable.html(activeAddressTXNshtr2EthRows.join());
  setClaimButtons();
}

function setClaimButtons() {
  document
    .querySelectorAll(".claim-button:not([disabled])")
    .forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        clearInterval(poolingIntervalId);
        poolingIntervalId = null;
        button.setAttribute('disabled', 'true');

        // The button carries only its index. The claim parameters are the typed
        // object the use case built — they no longer make a round trip through
        // string attributes, where an amount could be truncated or a hash lost.
        const index = Number(button.getAttribute("data-claim-index"));
        const transfer = loadedHathorTransfers[index];
        if (!transfer || !transfer.claim) {
          errorClaim("This transfer can no longer be claimed. Reload and try again.");
          startPoolingTxs();
          return;
        }

        claimToken(transfer.claim);
      });
    });
}

async function updateCallback(chainId, accounts) {
  await startPoolingTxs();
  return updateNetwork(chainId)
    .then(() => updateAddress(accounts))
    .then((addr) => updateActiveAddressTXNs(addr))
    .then(fillHathorToEvmTxs)
    .then(showActiveAddressTXNs)
    ;
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

    if (poolingIntervalId) {
      clearInterval(poolingIntervalId);
    }
    await startPoolingTxs();

    if (TXN_Storage.isStorageAvailable("localStorage")) {
      console.log(`Local Storage Available!`);
    } else {
      console.log(`Local Storage Unavailable!`);
    }

  } catch (err) {
    onMetaMaskConnectionError(err);
    throw err;
  }
}

async function startPoolingTxs() {
  poolingIntervalId = await poll4LastBlockNumber(async function (
    blockNumber
  ) {
    currentBlockNumber = blockNumber;
    await fillHathorToEvmTxs();
    showActiveAddressTXNs();
  });
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

window.addEventListener('hathortransfer:sent', function (event) {
  const { evmDestination } = event.detail;

  // Always show the Hathor→EVM transfers of the destination address; if an EVM
  // wallet is connected, refresh its own transfers too.
  //
  // The Hathor network name comes from the config object rather than through
  // `config`, which is null until an EVM wallet is connected — and that form
  // works without one.
  const hathorNetworkName = (isTestnet ? HTR_TESTNET_CONFIG : HTR_MAINNET_CONFIG).name;
  activeAddresseth2HtrTxns = TXN_Storage.getAllTxns4Address(evmDestination, hathorNetworkName);
  if (address) {
    activeAddresshtr2EthTxns = TXN_Storage.getAllTxns4Address(address, config.name);
  }
  showActiveAddressTXNs();

  // Switch to the HTR→ARB history tab so the user can track the transaction.
  showEvmTxsnTabe();
  location.hash = '';
  location.hash = '#nav-eth-htr-tab';
});
