import { clerkMeta, ready } from './clerk.js';

const { key, host } = clerkMeta();
if (key && host) {
  ready(key, host)
    .then(async (clerk) => {
      await clerk.load();
      await clerk.signOut({ redirectUrl: '/' });
    })
    .catch(() => {
      window.location.assign('/');
    });
}
