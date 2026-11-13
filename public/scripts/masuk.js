const key = document.querySelector('meta[name="clerk-key"]')?.content ?? '';
const host = document.querySelector('meta[name="clerk-host"]')?.content ?? '';
const button = document.querySelector('#google');
if (!key || !host || !button) {
  button?.setAttribute('disabled', 'true');
} else {
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.dataset.clerkPublishableKey = key;
  script.src = `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
  script.addEventListener('load', async () => {
    const clerk = window.Clerk;
    if (!clerk) return;
    await clerk.load();
    button.addEventListener('click', () => {
      void clerk.client.signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/masuk',
        redirectUrlComplete: '/dasbor',
      });
    });
  });
  document.head.append(script);
}
