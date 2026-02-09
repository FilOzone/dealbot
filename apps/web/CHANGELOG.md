# Changelog

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
