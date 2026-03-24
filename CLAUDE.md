# DentalOrder — Claude Instructions

## Deployment

**Never deploy automatically.** Only deploy when explicitly asked with the word "deploy".

Before deploying, batch all pending changes into a single deploy:
1. Run `npx tsc --noEmit` — fix any errors before proceeding
2. Run `npx vercel --prod`

Do not deploy after every fix or feature. If multiple changes are made in a session, deploy once at the end when asked.

If a deploy fails due to a code error, fix the error first, then deploy again as a single follow-up — do not keep retrying.

Do not deploy to fix a TypeScript error, then deploy again for the next fix, then again for another. Fix everything first, then deploy once.
