import {
  clerkMeta,
  completeRedirect,
  oauthOptions,
  oauthReturned,
  primarySignInButton,
  ready,
  showError,
  signedIn,
  signInButtons,
} from './clerk.js';

const { key, host } = clerkMeta();
if (primarySignInButton()) {
  const returning = [
    ...new URLSearchParams(window.location.search).keys(),
  ].some((name) => name.startsWith('__clerk'));

  ready(key, host)
    .then(async (clerk) => {
      await clerk.load();
      if (signedIn(clerk)) {
        window.location.assign('/dasbor');
        return;
      }
      if (returning || oauthReturned(clerk)) {
        await clerk.handleRedirectCallback(completeRedirect);
        if (signedIn(clerk)) window.location.assign('/dasbor');
        return;
      }
      const onClick = () => {
        void clerk.client.signIn
          .authenticateWithRedirect(oauthOptions())
          .catch(showError);
      };
      signInButtons().forEach((el) => {
        if (el instanceof HTMLButtonElement) {
          el.addEventListener('click', onClick);
        }
      });
    })
    .catch(showError);
}
