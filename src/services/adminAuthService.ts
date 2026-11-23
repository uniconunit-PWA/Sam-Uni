export interface AdminSessionPayload {
  username: string;
  token: string;
  canManageSheetConfig: boolean;
}

export type AdminAuthResult =
  | { ok: true; session: AdminSessionPayload }
  | { ok: false; message: string };

interface StaticAdminAccountRecord {
  u: string;
  salt: string;
  hash: string;
  canManageSheetConfig: boolean;
}

const PBKDF2_ITERATIONS = 100_000;
const INVALID_CREDENTIAL_MESSAGE = 'ชื่อผู้ใช้หรือรหัสผ่านผู้ดูแลระบบไม่ถูกต้อง';

const STATIC_ADMIN_ACCOUNTS: StaticAdminAccountRecord[] = [
  {
    u: 'Admin',
    salt: '383ef2f27b4ce5e0ad025deacac631b9',
    hash: '7f91a10222aaee80da132fdcb1dd24d73abaeee400d25c14c17ea9d6f84390e0',
    canManageSheetConfig: false,
  },
  {
    u: '13367',
    salt: 'bdccfe4a8f3e080be65afaa8becfe407',
    hash: '8ea0e0e1088099af5776a2a4b0243df389efacd13b5390329e51e0fd5b84da60',
    canManageSheetConfig: false,
  },
  {
    u: '16479',
    salt: 'fbfeb54d62a65fcd3567e4314b281ddf',
    hash: '67d63312aeefb6e043201ce6d8d83ae276d8fe4dec10515e66a7e23d7aee04a4',
    canManageSheetConfig: false,
  },
  {
    u: '15563',
    salt: '4c92a9380e3b6c1bd2eb4e56424d7bc6',
    hash: '59926b3a245deaca733b4b8d0846d17209a90090560c0c68ee27267b7db4d07f',
    canManageSheetConfig: true,
  },
  {
    u: '14356',
    salt: '874136ebbf818e096f29843972fc074c',
    hash: 'e09b422b17c9593172a4b063bc1bfb37a35ddbdf0279cc9a02d72c47f0c94a42',
    canManageSheetConfig: false,
  },
  {
    u: '15687',
    salt: '2b3de1ceeefcfcd248adc69037e36f50',
    hash: 'c2cb2ee79cda3f78a43bc139c5ab0f5b270163c01858389f8c235b3f1a902e8e',
    canManageSheetConfig: false,
  },
  {
    u: '17191',
    salt: '6a5998c47e89a973ac457d00f256b0e2',
    hash: 'ad79a7cade4a309d974cd78f07596ba8bd710a0a2d3e924f398ab259de1f9667',
    canManageSheetConfig: false,
  },
  {
    u: '15676',
    salt: 'd3a8174bd5bfae3ab9ad627902923cef',
    hash: '47067c3bb9721657d456a992d4dd909bfe6d6edde9aba7754a5a5bb93d335499',
    canManageSheetConfig: false,
  },
];

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function constantTimeEqualHex(aHex: string, bHex: string): boolean {
  if (aHex.length !== bHex.length) return false;
  let diff = 0;
  for (let i = 0; i < aHex.length; i += 1) {
    diff |= aHex.charCodeAt(i) ^ bHex.charCodeAt(i);
  }
  return diff === 0;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Bytes(data: Uint8Array): Uint8Array {
  const bitLen = data.length * 8;
  const paddedLen = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 =
        ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^
        ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^
        (w[i - 15] >>> 3);
      const s1 =
        ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^
        ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^
        (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  outView.setUint32(20, h5, false);
  outView.setUint32(24, h6, false);
  outView.setUint32(28, h7, false);
  return out;
}

function hmacSha256Bytes(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const k = key.length > 64 ? sha256Bytes(key) : key;
  const ipad = new Uint8Array(64 + msg.length);
  const opad = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i += 1) {
    const kb = i < k.length ? k[i] : 0;
    ipad[i] = kb ^ 0x36;
    opad[i] = kb ^ 0x5c;
  }
  ipad.set(msg, 64);
  opad.set(sha256Bytes(ipad), 64);
  return sha256Bytes(opad);
}

function pbkdf2Sha256FallbackHex(
  password: string,
  saltBytes: Uint8Array,
  iterations: number
): string {
  const pwdBytes = new TextEncoder().encode(password);
  const block1Input = new Uint8Array(saltBytes.length + 4);
  block1Input.set(saltBytes);
  block1Input[saltBytes.length + 3] = 1;

  let u = hmacSha256Bytes(pwdBytes, block1Input);
  const acc = new Uint8Array(u);
  for (let i = 1; i < iterations; i += 1) {
    u = hmacSha256Bytes(pwdBytes, u);
    for (let j = 0; j < 32; j += 1) {
      acc[j] ^= u[j];
    }
  }
  return bytesToHex(acc);
}

async function derivePbkdf2Hex(password: string, saltHex: string): Promise<string> {
  const saltBytes = hexToBytes(saltHex);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const keyMaterial = await subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
      );
      const saltBuffer = new Uint8Array(saltBytes).buffer;
      const derived = await subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: saltBuffer,
          iterations: PBKDF2_ITERATIONS,
          hash: 'SHA-256',
        },
        keyMaterial,
        256
      );
      return bytesToHex(new Uint8Array(derived));
    } catch {
      // Fall through to pure-TS PBKDF2 in restricted contexts
    }
  }
  return pbkdf2Sha256FallbackHex(password, saltBytes, PBKDF2_ITERATIONS);
}

async function verifyStaticFallback(username: string, password: string): Promise<AdminAuthResult> {
  const account = STATIC_ADMIN_ACCOUNTS.find(
    (acc) => acc.u.toLowerCase() === username.toLowerCase()
  );
  if (!account) {
    return { ok: false, message: INVALID_CREDENTIAL_MESSAGE };
  }

  const derivedHex = await derivePbkdf2Hex(password, account.salt);
  if (!constantTimeEqualHex(derivedHex, account.hash)) {
    return { ok: false, message: INVALID_CREDENTIAL_MESSAGE };
  }

  return {
    ok: true,
    session: {
      username: account.u,
      token: '',
      canManageSheetConfig: account.canManageSheetConfig,
    },
  };
}

export async function authenticateAdmin(
  username: string,
  password: string
): Promise<AdminAuthResult> {
  const u = username.trim();
  const p = password.trim();
  if (!u || !p) {
    return { ok: false, message: 'กรุณาระบุชื่อผู้ใช้และรหัสผ่าน' };
  }

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p }),
    });

    const rawText = await res.text().catch(() => '');
    let parsed: Record<string, unknown> | null = null;
    try {
      const obj = rawText ? JSON.parse(rawText) : null;
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        parsed = obj as Record<string, unknown>;
      }
    } catch {
      parsed = null;
    }

    if (res.ok && parsed?.ok === true && typeof parsed?.token === 'string' && parsed.token) {
      return {
        ok: true,
        session: {
          username: typeof parsed.username === 'string' ? parsed.username : u,
          token: parsed.token,
          canManageSheetConfig: Boolean(parsed.canManageSheetConfig),
        },
      };
    }

    // Backend is present and returned an explicit auth rejection (400 / 401 / 403 with ok: false): do not bypass it.
    if (
      (res.status === 400 || res.status === 401 || res.status === 403) &&
      parsed &&
      parsed.ok === false
    ) {
      return {
        ok: false,
        message:
          typeof parsed.message === 'string' && parsed.message.trim()
            ? parsed.message
            : INVALID_CREDENTIAL_MESSAGE,
      };
    }

    // Otherwise static host (Vercel / GitHub Pages / Netlify / vite preview / SPA HTML fallback): verify locally.
    return await verifyStaticFallback(u, p);
  } catch {
    // Offline or cross-origin / Apps Script host where /api/admin/login cannot be reached
    return await verifyStaticFallback(u, p);
  }
}
