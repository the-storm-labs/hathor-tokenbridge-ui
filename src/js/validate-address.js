const HathorWallet = {
  validateAddress(address) {
    try {
      bitcoinjs.address.fromBase58Check(address);
      return true;
    } catch (e) {
      return false;
    }
  }
};
