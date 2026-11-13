import {
  clerkMeta,
  oauthOptions,
  primarySignInButton,
  ready,
  showError,
  signInButtons,
} from './clerk.js';

const { key, host } = clerkMeta();
if (primarySignInButton() && key && host) {
  let loading = null;
  const start = (event) => {
    const el = event.currentTarget;
    if (el instanceof HTMLButtonElement) el.disabled = true;
    loading = loading ?? ready(key, host);
    void loading
      .then(async (clerk) => {
        await clerk.load();
        await clerk.client.signIn.authenticateWithRedirect(oauthOptions());
      })
      .catch((error) => {
        loading = null;
        if (el instanceof HTMLButtonElement) el.disabled = false;
        showError(error);
      });
  };
  signInButtons().forEach((el) => {
    el.addEventListener('click', start);
  });
}
