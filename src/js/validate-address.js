const HathorWallet = {
  getChecksum(bytes) {
    const wordArray = CryptoJS.lib.WordArray.create(bytes);
    const hash1 = CryptoJS.SHA256(wordArray);
    const hash2 = CryptoJS.SHA256(hash1);

    // The checksum is the first 4 bytes of the final hash.
    // We need to convert the first word of the hash back to a byte array.
    const firstWord = hash2.words[0];
    return [
      (firstWord >> 24) & 0xff,
      (firstWord >> 16) & 0xff,
      (firstWord >> 8) & 0xff,
      firstWord & 0xff
    ];
  },

  validateAddress(address) {
    try {
      const addressBytes = bs58.decode(address);

      if (addressBytes.length !== 25) {
        return false;
      }

      const checksum = addressBytes.slice(-4);
      const addressSlice = addressBytes.slice(0, -4);

      const correctChecksum = this.getChecksum(addressSlice);

      // Compare checksums
      for (let i = 0; i < 4; i++) {
        if (checksum[i] !== correctChecksum[i]) {
          return false;
        }
      }

      return true;
    } catch (e) {
      // This will catch errors from bs58.decode for invalid characters
      // or other issues.
      return false;
    }
  }
};
