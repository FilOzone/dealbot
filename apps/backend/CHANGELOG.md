# Changelog

## [0.2.0](https://github.com/FilOzone/dealbot/compare/backend-v0.1.2...backend-v0.2.0) (2026-01-23)


### Features

* use filecoin-pin for IPNI validation ([#124](https://github.com/FilOzone/dealbot/issues/124)) ([e9298ac](https://github.com/FilOzone/dealbot/commit/e9298ac9956dbf5df2f3dbd577871f2e63ef9336))


### Bug Fixes

* **backend:** negative avg time to retrieve metrics ([#140](https://github.com/FilOzone/dealbot/issues/140)) ([3da277f](https://github.com/FilOzone/dealbot/commit/3da277fcf14116b886d0e85c350083c657a78866))
* better error messages and ipni data size check fix ([#151](https://github.com/FilOzone/dealbot/issues/151)) ([a52050c](https://github.com/FilOzone/dealbot/commit/a52050cd9355ab08bd2d56500d3c69344c61a2f2))
* ENV var defaults ([#142](https://github.com/FilOzone/dealbot/issues/142)) ([24ffa9f](https://github.com/FilOzone/dealbot/commit/24ffa9f9b2493ebca7eed9a2326ea8f72336124b))
* pass valid accept/format parameter for ipfs query ([#155](https://github.com/FilOzone/dealbot/issues/155)) ([30ca5d6](https://github.com/FilOzone/dealbot/commit/30ca5d6fdc727e4e56c085142c186471c305d146))
* use node:24-alpine ([#148](https://github.com/FilOzone/dealbot/issues/148)) ([57510bf](https://github.com/FilOzone/dealbot/commit/57510bf21c277635330a6089f4fe05922f9387dc))
* use node:25-alpine for docker images ([#146](https://github.com/FilOzone/dealbot/issues/146)) ([e53ea5c](https://github.com/FilOzone/dealbot/commit/e53ea5c38b6effa4896f4e70a0c94d85d9600f29))

## [0.1.2](https://github.com/FilOzone/dealbot/compare/backend-v0.1.1...backend-v0.1.2) (2026-01-20)


### Bug Fixes

* **backend:** add optional dealbot dataset versioning ([#131](https://github.com/FilOzone/dealbot/issues/131)) ([597b6ea](https://github.com/FilOzone/dealbot/commit/597b6ea53d4ad2c9e991c97b0c07863fac1c1dab))

## [0.1.1](https://github.com/FilOzone/dealbot/compare/backend-v0.1.0...backend-v0.1.1) (2026-01-20)


### Bug Fixes

* create random data when others fail ([#127](https://github.com/FilOzone/dealbot/issues/127)) ([3d30ce7](https://github.com/FilOzone/dealbot/commit/3d30ce761ababc32ac6f38c250bbaf19df02c1e1))

## [0.1.0](https://github.com/FilOzone/dealbot/compare/backend-v0.0.1...backend-v0.1.0) (2026-01-16)


### Features

* add initial database migration for core tables ([#104](https://github.com/FilOzone/dealbot/issues/104)) ([0e47a64](https://github.com/FilOzone/dealbot/commit/0e47a64877e1fe1210689246f7bb31678ca9f927))
* **backend:** enhance CORS configuration with * support ([#117](https://github.com/FilOzone/dealbot/issues/117)) ([e484374](https://github.com/FilOzone/dealbot/commit/e4843742ab28dbd083f582ba70b59ba71a415cc4))
* kustomize for local & prod k8s ([#106](https://github.com/FilOzone/dealbot/issues/106)) ([36ef133](https://github.com/FilOzone/dealbot/commit/36ef13323198601242620536852ea67661c94be2))
* use pnpm workspace for better dx ([#96](https://github.com/FilOzone/dealbot/issues/96)) ([74e818d](https://github.com/FilOzone/dealbot/commit/74e818dc5da6b4b8d2646fbc54757f103efec100))


### Bug Fixes

* add http request and retrieval job timeouts ([#115](https://github.com/FilOzone/dealbot/issues/115)) ([edc872b](https://github.com/FilOzone/dealbot/commit/edc872bc0ac2d2d578decc2121abd0915b6735f5))
* exclude vitest.config.ts from build to prevent type errors ([#112](https://github.com/FilOzone/dealbot/issues/112)) ([5566814](https://github.com/FilOzone/dealbot/commit/556681431767b58464d754ff6645880950fcbfb0))
* **metrics:** correct totalProviders and activeProviders calculation ([#122](https://github.com/FilOzone/dealbot/issues/122)) ([75646a9](https://github.com/FilOzone/dealbot/commit/75646a9de0a24b9c64cfa52d0a8f104bbbd874b9))
* nest shutdown hooks and backend listening log ([#100](https://github.com/FilOzone/dealbot/issues/100)) ([e307089](https://github.com/FilOzone/dealbot/commit/e307089469e0ea33041bab9b9e1d4b81c398e36e))
* replace type-only imports with regular imports ([#103](https://github.com/FilOzone/dealbot/issues/103)) ([7ef731e](https://github.com/FilOzone/dealbot/commit/7ef731eb16d5ac0795ca099b19b73d9bbaac3b55))
