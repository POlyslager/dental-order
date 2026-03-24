# DentalOrder — Claude Instructions

## Deployment

**Never deploy automatically.** Only deploy when explicitly asked with the word "deploy".

Vercel is connected to GitHub and deploys automatically on every push. Therefore:

1. Run `npx tsc --noEmit` — fix any errors before proceeding
2. Commit all pending changes in a single commit
3. Run `git push` — this triggers the deploy automatically via the GitHub integration

**Never run `npx vercel --prod`** — it causes a duplicate deploy on top of the one GitHub already triggered.

Do not commit and push after every fix. Batch all changes in a session into one commit and one push.
