// lib/imageDimensions.ts
// Reject oversized compressed images before a browser allocates a decoded bitmap.
export function imageDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, count: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + count));
  const dimensions = (width: number, height: number) => {
    if (
      !width ||
      !height ||
      width * height > 20000000 ||
      width > 12000 ||
      height > 12000
    )
      throw new Error("This photo is too large. Choose a smaller one.");
    return { width, height };
  };
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    ascii(1, 3) === "PNG" &&
    ascii(12, 4) === "IHDR"
  )
    return dimensions(view.getUint32(16), view.getUint32(20));
  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const format = ascii(12, 4);
    if (format === "VP8X")
      return dimensions(
        1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      );
    if (
      format === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 1 &&
      bytes[25] === 0x2a
    )
      return dimensions(
        view.getUint16(26, true) & 0x3fff,
        view.getUint16(28, true) & 0x3fff,
      );
    if (format === "VP8L" && bytes[20] === 0x2f)
      return dimensions(
        1 + bytes[21] + ((bytes[22] & 63) << 8),
        1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10),
      );
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 8
      )
        return dimensions(
          view.getUint16(offset + 5),
          view.getUint16(offset + 3),
        );
      offset += length;
    }
  }
  throw new Error(
    "This photo could not be read. Choose a JPG, PNG, or WebP photo.",
  );
}
