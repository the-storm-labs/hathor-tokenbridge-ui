/**
 * Calculates the double SHA256 checksum for a byte array.
 * @param {number[]} bytes The byte array to hash.
 * @returns {number[]} The 4-byte checksum.
 */
function getChecksum(bytes) {
  // Helper to convert a byte array to a hex string.
  const bytesToHexString = (b) => b.map(x => ('00' + x.toString(16)).slice(-2)).join('');

  // Convert the byte array to a hex string, then to a CryptoJS WordArray.
  const hexSlice = bytesToHexString(bytes);
  const wordArray = CryptoJS.enc.Hex.parse(hexSlice);

  // Perform the double SHA256 hash.
  const hash1 = CryptoJS.SHA256(wordArray);
  const hash2 = CryptoJS.SHA256(hash1);

  // Convert the final hash back to a hex string.
  const finalHashHex = hash2.toString(CryptoJS.enc.Hex);

  // The checksum is the first 4 bytes (8 hex characters) of the final hash.
  const checksumHex = finalHashHex.substring(0, 8);

  // Convert the checksum hex string back to a byte array for comparison.
  const correctChecksum = [];
  for (let i = 0; i < checksumHex.length; i += 2) {
    correctChecksum.push(parseInt(checksumHex.substr(i, 2), 16));
  }
  return correctChecksum;
}

function validateHathorAddress(address) {
  try {
    const addressBytes = bs58.decode(address);

    if (addressBytes.length !== 25) {
      return false;
    }

    // The last 4 bytes are the checksum.
    const checksum = addressBytes.slice(-4);
    // The rest is the payload.
    const addressSlice = addressBytes.slice(0, -4);

    const correctChecksum = getChecksum(addressSlice);

    // Compare the checksum from the address with the calculated one.
    for (let i = 0; i < 4; i++) {
      if (checksum[i] !== correctChecksum[i]) {
        return false;
      }
    }

    // Network prefix validation
    const firstChar = address.charAt(0);
    if (isTestnet) {
      if (firstChar !== 'W' && firstChar !== 'w') {
        return false;
      }
    } else {
      if (firstChar !== 'H' && firstChar !== 'h') {
        return false;
      }
    }

    return true;
  } catch (e) {
    // This will catch errors from bs58.decode for invalid characters.
    return false;
  }
}
