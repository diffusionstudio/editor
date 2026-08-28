export function createBinaryString(nMask: number) {
  // nMask must be between -2147483648 and 2147483647
  let nFlag = 0;
  let nShifted = nMask;
  let sMask = '';

  while (nFlag < 32) {
    sMask += String(nShifted >>> 31);
    nShifted <<= 1;
    nFlag++;
  }

  return sMask;
}
