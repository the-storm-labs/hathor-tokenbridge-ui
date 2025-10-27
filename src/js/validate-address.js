const HathorWallet = {
  validateAddress(address) {
    const network = isTestnet ? 'testnet' : 'mainnet';
    try {
      const addressObj = new hathor.Address(address, { network });
      return addressObj.isValid();
    } catch (e) {
      return false;
    }
  }
};
