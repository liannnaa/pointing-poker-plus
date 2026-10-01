// Unambiguous charset: no 0/O, 1/I/L
const CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateSessionCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CHARSET[bytes[i] % CHARSET.length];
  }
  return code;
}
