const HathorWallet = {
  validateAddress(address) {
    console.log('dsdsds')
    try {
      const addressBytes = bs58.decode(address);

      console.log('address size', addressBytes.length);
      if (addressBytes.length !== 25) {
        return false;
      }

      const checksum = addressBytes.slice(-4);
      const addressSlice = addressBytes.slice(0, -4);

      const hash = CryptoJS.SHA256(CryptoJS.SHA256(CryptoJS.lib.WordArray.create(addressSlice)));
      const correctChecksum = new Uint8Array(hash.words.slice(0, 1).map(word => [
        (word >> 24) & 0xff,
        (word >> 16) & 0xff,
        (word >> 8) & 0xff,
        word & 0xff
      ]).flat());

      for (let i = 0; i < 4; i++) {
        if (checksum[i] !== correctChecksum[i]) {
          return false;
        }
      }

      return true;
    } catch (e) {
      console.log('error', e)
      return false;
    }
  }
};
