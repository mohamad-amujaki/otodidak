export const signInButtons = () =>
  document.querySelectorAll('.js-google-signin');

export function primarySignInButton() {
  const first = signInButtons()[0];
  return first instanceof HTMLButtonElement ? first : null;
}

export function clerkMeta() {
  const key = document.querySelector('meta[name="clerk-key"]')?.content ?? '';
  const host = document.querySelector('meta[name="clerk-host"]')?.content ?? '';
  return { key, host };
}

export function oauthOptions() {
  const topik =
    document.querySelector('meta[name="masuk-topik"]')?.content ?? '';
  return {
    strategy: 'oauth_google',
    redirectUrl: topik ? `/masuk?topik=${encodeURIComponent(topik)}` : '/masuk',
    redirectUrlComplete: topik
      ? `/dasbor?topik=${encodeURIComponent(topik)}`
      : '/dasbor',
  };
}

export const completeRedirect = {
  signInForceRedirectUrl: '/dasbor',
  signUpForceRedirectUrl: '/dasbor',
  signInFallbackRedirectUrl: '/dasbor',
  signUpFallbackRedirectUrl: '/dasbor',
};

export function signedIn(clerk) {
  return Boolean(clerk.session || clerk.user);
}

export function oauthReturned(clerk) {
  const signIn = clerk.client?.signIn;
  const signUp = clerk.client?.signUp;
  const external = signUp?.verifications?.externalAccount;
  const factor = signIn?.firstFactorVerification?.status;
  return (
    Boolean(signIn?.createdSessionId) ||
    Boolean(signUp?.createdSessionId) ||
    signIn?.status === 'complete' ||
    signUp?.status === 'complete' ||
    factor === 'transferable' ||
    external?.status === 'transferable' ||
    external?.status === 'verified'
  );
}

export function showError(error) {
  const anchor = primarySignInButton();
  const detail =
    error?.errors?.[0]?.longMessage ??
    error?.errors?.[0]?.message ??
    error?.message ??
    'Masuk dengan Google gagal. Muat ulang halaman lalu coba lagi.';
  let box = document.querySelector('#masuk-galat');
  if (!(box instanceof HTMLElement)) {
    box = document.createElement('p');
    box.id = 'masuk-galat';
    box.setAttribute('role', 'alert');
    box.className = 'mt-3 text-sm text-bahaya';
    anchor?.after(box);
  }
  box.textContent = detail;
  console.error('[masuk]', error);
}

export function ready(key, host) {
  if (window.Clerk) return Promise.resolve(window.Clerk);
  const present = document.querySelector('script[data-clerk-js-script]');
  if (!present && key && host) {
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.clerkPublishableKey = key;
    script.src = `https://${host}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`;
    document.head.append(script);
  }
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (window.Clerk) {
        clearInterval(timer);
        resolve(window.Clerk);
        return;
      }
      if (Date.now() - started > 8000) {
        clearInterval(timer);
        reject(new Error('clerk'));
      }
    }, 50);
  });
}
