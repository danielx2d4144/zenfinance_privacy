# Railway Deployment - Root Directory Fix

Railway needs access to both `data-api` and `prover-service` because data-api depends on prover-service.

## In Railway Dashboard:

1. Go to **Settings** → **Source**
2. Set **Root Directory** to: `code/backend`
3. Click **Redeploy**

This way Railway can access both directories during build.

The `nixpacks.toml` in `data-api` will handle building both packages in the correct order.
