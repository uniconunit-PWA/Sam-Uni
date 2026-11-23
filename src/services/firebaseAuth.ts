import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));
provider.setCustomParameters({
  prompt: 'select_account',
});

let isSigningIn = false;
// In-memory only access token cache (never stored in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;
let cachedUserEmail: string | null = null;

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            hint?: string;
            prompt?: string;
            callback: (response: {
              access_token?: string;
              error?: string;
              error_description?: string;
            }) => void;
            error_callback?: (error: { type: string; message?: string }) => void;
          }) => {
            requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void;
          };
        };
      };
    };
  }
}

let gisScriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  if (!gisScriptPromise) {
    gisScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('ไม่สามารถโหลด Google Identity Services ได้'));
      document.head.appendChild(script);
    });
  }
  return gisScriptPromise;
}

async function signInWithGisFallback(
  forceConsent = false
): Promise<{ email: string; accessToken: string }> {
  const clientId = (firebaseConfig as { oAuthClientId?: string }).oAuthClientId;
  if (!clientId) {
    throw new Error('ไม่พบ OAuth Client ID สำหรับเชื่อมต่อ Google Sheets / Drive');
  }

  await loadGisScript();

  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error('เบราว์เซอร์ไม่สามารถเปิดระบบยืนยันตัวตน Google ได้');
  }

  const promptMode = forceConsent ? 'consent' : '';
  const accessToken = await new Promise<string>((resolve, reject) => {
    const tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES.join(' '),
      hint: auth.currentUser?.email || undefined,
      prompt: promptMode,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(
            new Error(
              resp.error_description || resp.error || 'ไม่ได้รับสิทธิ์เข้าถึง Google Sheets / Drive'
            )
          );
          return;
        }
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        const rawMsg = (err?.message || err?.type || '').toLowerCase();
        const origin = typeof window !== 'undefined' ? window.location.origin : '';
        if (rawMsg.includes('closed') || rawMsg.includes('popup_closed')) {
          reject(
            new Error(
              `หน้าต่าง Google ถูกปิด หรือติด Error 400: origin_mismatch — กรุณาเพิ่มต้นทาง (Authorized JavaScript origins): ${origin} ใน Google Cloud Console หรือใช้ปุ่ม "ตั้งค่า Apps Script" แทน`
            )
          );
          return;
        }
        reject(new Error(err.message || 'หน้าต่างลงชื่อเข้าใช้ Google ถูกปิดหรือถูกบล็อก'));
      },
    });

    tokenClient.requestAccessToken({ prompt: promptMode });
  });

  // Fetch basic user email via Google userinfo if available, or fallback gracefully
  let email = auth.currentUser?.email || 'Google Account';
  try {
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (infoRes.ok) {
      const info = await infoRes.json();
      if (info?.email) email = info.email;
    }
  } catch {
    // userinfo scope may not be granted; email remains fallback
  }

  return { email, accessToken };
}

function mapFirebaseAuthError(error: any): string {
  const code = error?.code || '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  if (code === 'auth/popup-blocked') {
    return 'เบราว์เซอร์บล็อกหน้าต่าง Popup กรุณาอนุญาต Popup สำหรับเว็บไซต์นี้แล้วลองใหม่อีกครั้ง';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'ปิดหน้าต่างลงชื่อเข้าใช้ก่อนเสร็จสิ้น กรุณาลองใหม่อีกครั้ง';
  }
  if (code === 'auth/unauthorized-domain') {
    return `โดเมน ${host} (${origin}) ยังไม่ได้รับอนุญาตใน Firebase Auth / Google Cloud Console กรุณาเพิ่มใน Authorized domains และ Authorized JavaScript origins หรือใช้ "ตั้งค่า Apps Script" แทน`;
  }
  if (code === 'auth/network-request-failed') {
    return 'ไม่สามารถเชื่อมต่อเครือข่ายเพื่อยืนยันตัวตน Google ได้';
  }
  return error?.message || 'ไม่สามารถลงชื่อเข้าใช้ด้วย Google ได้';
}

export const initAuth = (
  onAuthSuccess?: (email: string, token: string) => void,
  onAuthTokenMissing?: (email: string | null) => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      const email = user.email || user.displayName || cachedUserEmail;
      if (cachedAccessToken && email) {
        onAuthSuccess?.(email, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthTokenMissing?.(email || null);
      }
    } else if (!cachedAccessToken && !isSigningIn) {
      cachedUserEmail = null;
      onAuthTokenMissing?.(null);
    }
  });
};

export const googleSignIn = async (
  forceConsent = false
): Promise<{ email: string; accessToken: string }> => {
  try {
    isSigningIn = true;
    const activeProvider = new GoogleAuthProvider();
    SCOPES.forEach((scope) => activeProvider.addScope(scope));
    activeProvider.setCustomParameters({
      prompt: forceConsent ? 'consent select_account' : 'select_account',
    });

    try {
      const result = await signInWithPopup(auth, activeProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        cachedAccessToken = credential.accessToken;
        cachedUserEmail =
          result.user.email || result.user.displayName || 'Google Account';
        return { email: cachedUserEmail, accessToken: cachedAccessToken };
      }
      // If Firebase succeeded without returning an OAuth access token, fall back to GIS token client
      const gis = await signInWithGisFallback(forceConsent);
      cachedAccessToken = gis.accessToken;
      cachedUserEmail = result.user.email || gis.email;
      return { email: cachedUserEmail, accessToken: cachedAccessToken };
    } catch (firebaseErr: any) {
      const code = firebaseErr?.code || '';
      // If user explicitly closed the popup, report immediately without double-prompting
      if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request'
      ) {
        throw new Error(mapFirebaseAuthError(firebaseErr));
      }
      // For domain/env/internal errors on preview domains, try GIS OAuth2 token client fallback
      try {
        const gis = await signInWithGisFallback(forceConsent);
        cachedAccessToken = gis.accessToken;
        cachedUserEmail = gis.email;
        return { email: cachedUserEmail, accessToken: cachedAccessToken };
      } catch (gisErr: any) {
        if (code === 'auth/unauthorized-domain') {
          throw new Error(mapFirebaseAuthError(firebaseErr));
        }
        throw new Error(gisErr?.message || mapFirebaseAuthError(firebaseErr));
      }
    }
  } finally {
    isSigningIn = false;
  }
};

export const trySilentAccessToken = async (
  emailHint?: string | null
): Promise<string | null> => {
  if (cachedAccessToken) return cachedAccessToken;
  const clientId = (firebaseConfig as { oAuthClientId?: string }).oAuthClientId;
  if (!clientId) return null;

  try {
    await loadGisScript();
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) return null;

    const hint = emailHint || auth.currentUser?.email || undefined;
    const token = await new Promise<string | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), 4000);
      const tokenClient = oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES.join(' '),
        hint,
        prompt: 'none',
        callback: (resp) => {
          window.clearTimeout(timer);
          if (resp?.access_token) {
            resolve(resp.access_token);
          } else {
            resolve(null);
          }
        },
        error_callback: () => {
          window.clearTimeout(timer);
          resolve(null);
        },
      });
      tokenClient.requestAccessToken({ prompt: 'none', hint });
    });

    if (token) {
      cachedAccessToken = token;
      if (hint) cachedUserEmail = hint;
    }
    return token;
  } catch {
    return null;
  }
};

export const getAccessToken = (): string | null => cachedAccessToken;

export const clearAccessToken = () => {
  cachedAccessToken = null;
};

export const logoutGoogle = async () => {
  try {
    await auth.signOut();
  } catch {
    // ignore signOut errors if only GIS token was active
  }
  cachedAccessToken = null;
  cachedUserEmail = null;
};
