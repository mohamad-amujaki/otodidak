const button = document.querySelector('#google');
if (button instanceof HTMLButtonElement) {
  const key = document.querySelector('meta[name="clerk-key"]')?.content ?? '';
  const host = document.querySelector('meta[name="clerk-host"]')?.content ?? '';
  const returning = [...new URLSearchParams(window.location.search).keys()].some(
    (name) => name.startsWith('__clerk'),
  );
  const destination = {
    signInForceRedirectUrl: '/dasbor',
    signUpForceRedirectUrl: '/dasbor',
    signInFallbackRedirectUrl: '/dasbor',
    signUpFallbackRedirectUrl: '/dasbor',
  };

  ready(key, host)
    .then(async (clerk) => {
      await clerk.load();
      if (signedIn(clerk)) {
        window.location.assign('/dasbor');
        return;
      }
      if (returning || oauthReturned(clerk)) {
        await clerk.handleRedirectCallback(destination);
        if (signedIn(clerk)) window.location.assign('/dasbor');
        return;
      }
      button.addEventListener('click', () => {
        void clerk.client.signIn.authenticateWithRedirect({
          strategy: 'oauth_google',
          redirectUrl: '/masuk',
          redirectUrlComplete: '/dasbor',
        });
      });
    })
    .catch(() => {
      button.disabled = true;
    });
}

function signedIn(clerk) {
  return Boolean(clerk.session || clerk.user);
}

function oauthReturned(clerk) {
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

function ready(key, host) {
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
