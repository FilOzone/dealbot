# Changelog

## [1.4.0](https://github.com/FilOzone/dealbot/compare/web-v1.3.1...web-v1.4.0) (2026-07-17)


### Features

* **web:** add multi-network support with network switcher ([#576](https://github.com/FilOzone/dealbot/issues/576)) ([c2c2be2](https://github.com/FilOzone/dealbot/commit/c2c2be2c33a309366c84a8bebc32eb8845fa3f6b))
* **web:** add per-network betterstack url configuration ([#625](https://github.com/FilOzone/dealbot/issues/625)) ([34143cd](https://github.com/FilOzone/dealbot/commit/34143cd0f4b9bd45eb9bbd9247e5cde5618f0cf3))


### Bug Fixes

* **deps:** bump @vitejs/plugin-react, lucide-react, and jsdom in /apps/web ([6f9ebcf](https://github.com/FilOzone/dealbot/commit/6f9ebcfc69dfaab2c0db405f2a1e189a0f5c049d))
* **deps:** bump @vitejs/plugin-react, lucide-react, and jsdom in /apps/web ([73072fa](https://github.com/FilOzone/dealbot/commit/73072fa4ea67e6c052008a403a26e98e93d6d078))


### Miscellaneous

* **deps-dev:** bump jsdom from 28.0.0 to 29.1.1 in /apps/web ([#496](https://github.com/FilOzone/dealbot/issues/496)) ([73072fa](https://github.com/FilOzone/dealbot/commit/73072fa4ea67e6c052008a403a26e98e93d6d078))
* **deps:** bump lucide-react from 0.563.0 to 1.24.0 in /apps/web ([#493](https://github.com/FilOzone/dealbot/issues/493)) ([6f9ebcf](https://github.com/FilOzone/dealbot/commit/6f9ebcfc69dfaab2c0db405f2a1e189a0f5c049d))

## [1.3.1](https://github.com/FilOzone/dealbot/compare/web-v1.3.0...web-v1.3.1) (2026-06-08)


### Miscellaneous

* **web:** migrate to SWR for data fetching ([#585](https://github.com/FilOzone/dealbot/issues/585)) ([33f62be](https://github.com/FilOzone/dealbot/commit/33f62bef521fdb95f34799fdda6dc94f5286cb69))

## [1.3.0](https://github.com/FilOzone/dealbot/compare/web-v1.2.0...web-v1.3.0) (2026-05-19)


### Features

* **web:** link to combined approved-SP dashboard on landing ([#525](https://github.com/FilOzone/dealbot/issues/525)) ([d2f21ce](https://github.com/FilOzone/dealbot/commit/d2f21ce3bd86a21c81450df1e1cf8e239a9412e1))


### Miscellaneous

* ban nested ternaries via biome ([#544](https://github.com/FilOzone/dealbot/issues/544)) ([3986d52](https://github.com/FilOzone/dealbot/commit/3986d5263fac130eeddfef068d9df8265f6fd521))
* **deps:** bump node from 24-alpine to 26-alpine in /apps/web ([#528](https://github.com/FilOzone/dealbot/issues/528)) ([e7ea2e0](https://github.com/FilOzone/dealbot/commit/e7ea2e0d40791483580425c7617cf2123e28031d))

## [1.2.0](https://github.com/FilOzone/dealbot/compare/web-v1.1.1...web-v1.2.0) (2026-05-05)


### Features

* **web:** add network switcher ([#472](https://github.com/FilOzone/dealbot/issues/472)) ([742c951](https://github.com/FilOzone/dealbot/commit/742c95136e1bf4def4f649413e6d05565ec03423))


### Bug Fixes

* make nullable entity fields explicitly typed ([#380](https://github.com/FilOzone/dealbot/issues/380)) ([872d444](https://github.com/FilOzone/dealbot/commit/872d4440102b5dcb85b1c5e02f5c84ea5aa23350))


### Miscellaneous

* **deps:** bump the npm-dependencies group across 1 directory with 7 updates ([#448](https://github.com/FilOzone/dealbot/issues/448)) ([7336ea2](https://github.com/FilOzone/dealbot/commit/7336ea2967b1e38937f373fc31847cbd4354d7e5))
* remove per-package pnpm-lock.yaml ([#499](https://github.com/FilOzone/dealbot/issues/499)) ([63a37be](https://github.com/FilOzone/dealbot/commit/63a37be0e85f360996296d7575ceecbcd96df2cc))

## [1.1.1](https://github.com/FilOzone/dealbot/compare/web-v1.1.0...web-v1.1.1) (2026-03-22)


### Bug Fixes

* landing page renders providers ([#391](https://github.com/FilOzone/dealbot/issues/391)) ([c6ffa51](https://github.com/FilOzone/dealbot/commit/c6ffa51ef51f0aa7967767cc9d034cc2f72d5ef9))

## [1.1.0](https://github.com/FilOzone/dealbot/compare/web-v1.0.1...web-v1.1.0) (2026-03-21)


### Features

* **web:** add approved status column to landing provider table ([#378](https://github.com/FilOzone/dealbot/issues/378)) ([5f6eb8b](https://github.com/FilOzone/dealbot/commit/5f6eb8bf437faf9d8b786e94f0a8a8ef54863823))


### Bug Fixes

* **backend:** include synapse 0.40.0 upgrade in release notes ([#388](https://github.com/FilOzone/dealbot/issues/388)) ([e38e186](https://github.com/FilOzone/dealbot/commit/e38e186af8f8ba1b8947641f1da024998529a735))

## [1.0.1](https://github.com/FilOzone/dealbot/compare/web-v1.0.0...web-v1.0.1) (2026-03-12)


### Bug Fixes

* simple landing page with link to dashboard and logs ([#313](https://github.com/FilOzone/dealbot/issues/313)) ([574afa8](https://github.com/FilOzone/dealbot/commit/574afa816dc10bf4789a8d2bd28417d9ffb6bf72))
* UI displays deep-links to provider dashboards ([#334](https://github.com/FilOzone/dealbot/issues/334)) ([ed7e890](https://github.com/FilOzone/dealbot/commit/ed7e89084848808df82a1d15c2f591663df617db))

## [1.0.0](https://github.com/FilOzone/dealbot/compare/web-v0.2.0...web-v1.0.0) (2026-03-03)


### ⚠ BREAKING CHANGES

* remove proxy support ([#283](https://github.com/FilOzone/dealbot/issues/283))

### Bug Fixes

* always disable CDN testing ([#264](https://github.com/FilOzone/dealbot/issues/264)) ([66d66df](https://github.com/FilOzone/dealbot/commit/66d66df5a2b3b0b4203b3a1338167c8bceedb9a8))


### Code Refactoring

* remove proxy support ([#283](https://github.com/FilOzone/dealbot/issues/283)) ([bb68729](https://github.com/FilOzone/dealbot/commit/bb68729d0840e3d4bb6e599264e106a773ebefac))

## [0.2.0](https://github.com/FilOzone/dealbot/compare/web-v0.1.4...web-v0.2.0) (2026-02-09)


### Features

* **web:** setup new dashboard routes and layout ([#229](https://github.com/FilOzone/dealbot/issues/229)) ([6fae8e1](https://github.com/FilOzone/dealbot/commit/6fae8e1b1f430887c19d5c75937085436e94a7df))


### Bug Fixes

* web dockerFile builds ([#235](https://github.com/FilOzone/dealbot/issues/235)) ([df0fec9](https://github.com/FilOzone/dealbot/commit/df0fec9df97231dea2ab53af638cd28dbdeae914))
* web tests should run despite env ([#233](https://github.com/FilOzone/dealbot/issues/233)) ([a522647](https://github.com/FilOzone/dealbot/commit/a522647a72fc7f72cc0eba72849b8f69eb6de562))

## [0.1.4](https://github.com/FilOzone/dealbot/compare/web-v0.1.3...web-v0.1.4) (2026-02-04)


### Bug Fixes

* add missing docker files ([#224](https://github.com/FilOzone/dealbot/issues/224)) ([415ce42](https://github.com/FilOzone/dealbot/commit/415ce426250d73e83a641f0f53f0d62da6081160))
* enhance provider health calculations and update UI stats ([#154](https://github.com/FilOzone/dealbot/issues/154)) ([9dccc64](https://github.com/FilOzone/dealbot/commit/9dccc64c99f6226cc4ea86f984b60e71641c9ae9))
* **metrics:** export prometheus providers and proxy /metrics ([#161](https://github.com/FilOzone/dealbot/issues/161)) ([33612e4](https://github.com/FilOzone/dealbot/commit/33612e495da63fe0d3b75bc0b1f3ad2643027a95)), closes [#147](https://github.com/FilOzone/dealbot/issues/147)
* use new rechart types ([#204](https://github.com/FilOzone/dealbot/issues/204)) ([593acf3](https://github.com/FilOzone/dealbot/commit/593acf3ef7455146b6b71ed0eb2d3f46bf887287))

## [0.1.3](https://github.com/FilOzone/dealbot/compare/web-v0.1.2...web-v0.1.3) (2026-01-23)


### Bug Fixes

* **backend:** negative avg time to retrieve metrics ([#140](https://github.com/FilOzone/dealbot/issues/140)) ([3da277f](https://github.com/FilOzone/dealbot/commit/3da277fcf14116b886d0e85c350083c657a78866))
* use node:24-alpine ([#148](https://github.com/FilOzone/dealbot/issues/148)) ([57510bf](https://github.com/FilOzone/dealbot/commit/57510bf21c277635330a6089f4fe05922f9387dc))
* use node:25-alpine for docker images ([#146](https://github.com/FilOzone/dealbot/issues/146)) ([e53ea5c](https://github.com/FilOzone/dealbot/commit/e53ea5c38b6effa4896f4e70a0c94d85d9600f29))

## [0.1.2](https://github.com/FilOzone/dealbot/compare/web-v0.1.1...web-v0.1.2) (2026-01-20)


### Bug Fixes

* **web:** use OR for version fallback ([#133](https://github.com/FilOzone/dealbot/issues/133)) ([922665d](https://github.com/FilOzone/dealbot/commit/922665dd5635507b1980a435181ae8f746ff777f))

## [0.1.1](https://github.com/FilOzone/dealbot/compare/web-v0.1.0...web-v0.1.1) (2026-01-20)


### Bug Fixes

* **web:** display 'Unknown' for curio version when SP version check fails ([#125](https://github.com/FilOzone/dealbot/issues/125)) ([3b86ffe](https://github.com/FilOzone/dealbot/commit/3b86ffe4b44b1e5b87e554aa8f76cd79143382e3))

## [0.1.0](https://github.com/FilOzone/dealbot/compare/web-v0.0.1...web-v0.1.0) (2026-01-16)


### Features

* kustomize for local & prod k8s ([#106](https://github.com/FilOzone/dealbot/issues/106)) ([36ef133](https://github.com/FilOzone/dealbot/commit/36ef13323198601242620536852ea67661c94be2))
* use pnpm workspace for better dx ([#96](https://github.com/FilOzone/dealbot/issues/96)) ([74e818d](https://github.com/FilOzone/dealbot/commit/74e818dc5da6b4b8d2646fbc54757f103efec100))


### Bug Fixes

* **metrics:** correct totalProviders and activeProviders calculation ([#122](https://github.com/FilOzone/dealbot/issues/122)) ([75646a9](https://github.com/FilOzone/dealbot/commit/75646a9de0a24b9c64cfa52d0a8f104bbbd874b9))
