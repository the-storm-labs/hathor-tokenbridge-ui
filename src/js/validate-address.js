const HathorWallet = {
  validateAddress(address) {
    try {
      const addressBytes = bs58check.decode(address);

      // Validate address length
      if (addressBytes.length !== 25) {
        console.error(`Invalid address: ${address}. Address has ${addressBytes.length} bytes and should have 25.`);
        return false;
      }

      // Checksum is already validated by bs58check.decode()

      return true;
    } catch (e) {
      console.error(`Invalid address: ${address}.`, e);
      return false;
    }
  }
};
