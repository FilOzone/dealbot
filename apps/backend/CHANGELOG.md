# Changelog

## [1.0.0](https://github.com/FilOzone/dealbot/compare/backend-v0.4.0...backend-v1.0.0) (2026-02-27)


### ⚠ BREAKING CHANGES

* remove proxy support ([#283](https://github.com/FilOzone/dealbot/issues/283))

### Features

* add metrics for data-storage-check ([#287](https://github.com/FilOzone/dealbot/issues/287)) ([34659ae](https://github.com/FilOzone/dealbot/commit/34659ae129d0cfb877f19d9f9dcb408f26214b1e))
* cap deal/retrievals with abort signals ([#263](https://github.com/FilOzone/dealbot/issues/263)) ([0623bcf](https://github.com/FilOzone/dealbot/commit/0623bcfc19286ed4429296dd6b9c819116eb6c74))


### Bug Fixes

* add explicit text type to job_schedule_state columns ([#316](https://github.com/FilOzone/dealbot/issues/316)) ([393de08](https://github.com/FilOzone/dealbot/commit/393de083e4ae88960777863cded359d946ce73f4))
* align retrieval checks with docs ([#299](https://github.com/FilOzone/dealbot/issues/299)) ([27f9219](https://github.com/FilOzone/dealbot/commit/27f9219eb504dd5bc5716b80e675b528f83cef18))
* always disable CDN testing ([#264](https://github.com/FilOzone/dealbot/issues/264)) ([66d66df](https://github.com/FilOzone/dealbot/commit/66d66df5a2b3b0b4203b3a1338167c8bceedb9a8))
* dont let nest quit silently ([#317](https://github.com/FilOzone/dealbot/issues/317)) ([e7e42d9](https://github.com/FilOzone/dealbot/commit/e7e42d95c346e70337fdb8e7b42484fde911feb8))
* emit overall data-storage check status ([#296](https://github.com/FilOzone/dealbot/issues/296)) ([690b656](https://github.com/FilOzone/dealbot/commit/690b656ca7eaea5850f39b2f54adbd5f358e4f5a))
* emit per-block TTFB for ipfs block fetch ([#298](https://github.com/FilOzone/dealbot/issues/298)) ([6e4332f](https://github.com/FilOzone/dealbot/commit/6e4332ff1ef3f255d7fe21a33834df0bef4df9d3))
* enable typeorm logging for database queries ([#318](https://github.com/FilOzone/dealbot/issues/318)) ([61d8819](https://github.com/FilOzone/dealbot/commit/61d88199dad4f89538a378fa8fdd04ac84b54ca1))
* ipfs data is validated ([#249](https://github.com/FilOzone/dealbot/issues/249)) ([aa6ddd2](https://github.com/FilOzone/dealbot/commit/aa6ddd21749d70c247d89aba46ff32590269153c))
* log datasource startup errors ([#315](https://github.com/FilOzone/dealbot/issues/315)) ([19a7d70](https://github.com/FilOzone/dealbot/commit/19a7d709ee7e1b3e3a23a238e012081198cf6e91))
* log full pieceCid, CID, and providerAddresses ([#244](https://github.com/FilOzone/dealbot/issues/244)) ([bc9c0a2](https://github.com/FilOzone/dealbot/commit/bc9c0a2fedb3d32a77d929b60f343458d68a9fce))
* more granular job duration buckets ([#291](https://github.com/FilOzone/dealbot/issues/291)) ([36fbf28](https://github.com/FilOzone/dealbot/commit/36fbf28de424b3de5d50fe3f4e19003095653540))
* more granular throughput buckets ([#308](https://github.com/FilOzone/dealbot/issues/308)) ([24135d3](https://github.com/FilOzone/dealbot/commit/24135d320e31ee1c875b2fd65e38bc61f185a87e))
* optimize sp-performance-query.helper.ts ([#320](https://github.com/FilOzone/dealbot/issues/320)) ([45d05d4](https://github.com/FilOzone/dealbot/commit/45d05d4a07b6a8b17b1bd099d9eaf0ab284bb661))
* pgboss upgrade db migrations ([#269](https://github.com/FilOzone/dealbot/issues/269)) ([a26b14a](https://github.com/FilOzone/dealbot/commit/a26b14ad8cd9f60e5c305bc4b6ac163de04f8e6c))
* providers table is updated every 4 hours ([#268](https://github.com/FilOzone/dealbot/issues/268)) ([e5debd9](https://github.com/FilOzone/dealbot/commit/e5debd9bb27609fd20648efbd4cc786dd00d8aa4))
* providers.refresh queue is created on scheduler startup ([#302](https://github.com/FilOzone/dealbot/issues/302)) ([29b7a69](https://github.com/FilOzone/dealbot/commit/29b7a69ebfaa28902c4919b949f94fa5e1a2bb80))
* remove RETRIEVAL_TIMEOUT_BUFFER_MS ([#266](https://github.com/FilOzone/dealbot/issues/266)) ([4f650a8](https://github.com/FilOzone/dealbot/commit/4f650a809e9ab571985c718a4be7308c70a31f46))
* startup error logging ([#314](https://github.com/FilOzone/dealbot/issues/314)) ([2024276](https://github.com/FilOzone/dealbot/commit/2024276cb353520b6e6e87f24c1d55831d4ff2d8))
* use single pgboss queue to enforce per SP lock ([#247](https://github.com/FilOzone/dealbot/issues/247)) ([6fe757a](https://github.com/FilOzone/dealbot/commit/6fe757acf881405dfa6a87de0f4830a406f95154))
* use structured logging ([#312](https://github.com/FilOzone/dealbot/issues/312)) ([8dd77d8](https://github.com/FilOzone/dealbot/commit/8dd77d890e5ddeca025280976b50428c70fc2b75))


### Code Refactoring

* remove proxy support ([#283](https://github.com/FilOzone/dealbot/issues/283)) ([bb68729](https://github.com/FilOzone/dealbot/commit/bb68729d0840e3d4bb6e599264e106a773ebefac))

## [0.4.0](https://github.com/FilOzone/dealbot/compare/backend-v0.3.0...backend-v0.4.0) (2026-02-09)


### Features

* **backend:** add daily maintenance windows ([#225](https://github.com/FilOzone/dealbot/issues/225)) ([5a0e481](https://github.com/FilOzone/dealbot/commit/5a0e4815405d38159c23e1fbdbf5dc78d0bcda0d))
* **metrics:** add minimal pg-boss job health metrics ([#223](https://github.com/FilOzone/dealbot/issues/223)) ([31e2db6](https://github.com/FilOzone/dealbot/commit/31e2db6b1a4ff220648e7dc2ba8bf510b7da34bd))
* split worker and api ([#240](https://github.com/FilOzone/dealbot/issues/240)) ([bbaf671](https://github.com/FilOzone/dealbot/commit/bbaf6712bfd5df7eebcbedbb8d55e991797f08e0))


### Bug Fixes

* add local grafana and prom services ([#242](https://github.com/FilOzone/dealbot/issues/242)) ([8757943](https://github.com/FilOzone/dealbot/commit/875794385aecbdfe63f53668ff323a9c9346a419))
* delete inactive provider schedules ([#230](https://github.com/FilOzone/dealbot/issues/230)) ([74096ef](https://github.com/FilOzone/dealbot/commit/74096ef62654c10217e511aec192146d7a43ccab))
* increase concurrency for deals & retrievals ([#236](https://github.com/FilOzone/dealbot/issues/236)) ([c7d177b](https://github.com/FilOzone/dealbot/commit/c7d177bb8999b2506dfade5f434628b33acfc6f4))
* increase deal/retrieval job concurrency ([#232](https://github.com/FilOzone/dealbot/issues/232)) ([1b36f16](https://github.com/FilOzone/dealbot/commit/1b36f162e64356b25f450c3f32e50d0bd7c39164))
* limit db connections ([#243](https://github.com/FilOzone/dealbot/issues/243)) ([90d1616](https://github.com/FilOzone/dealbot/commit/90d1616fc327da57d651bdee3de2b96352dc0aa8))
* normalize job state metrics ([#234](https://github.com/FilOzone/dealbot/issues/234)) ([c04feb6](https://github.com/FilOzone/dealbot/commit/c04feb65e242fbbcf9b54924adc85749270c5255))
* web dockerFile builds ([#235](https://github.com/FilOzone/dealbot/issues/235)) ([df0fec9](https://github.com/FilOzone/dealbot/commit/df0fec9df97231dea2ab53af638cd28dbdeae914))

## [0.3.0](https://github.com/FilOzone/dealbot/compare/backend-v0.2.0...backend-v0.3.0) (2026-02-04)


### Features

* add pg-boss scheduling with per‑SP rate control and durable queues ([#181](https://github.com/FilOzone/dealbot/issues/181)) ([e781e76](https://github.com/FilOzone/dealbot/commit/e781e76094aa5fe296949ec16beba21b573e451e))
* add prometheus metrics ([#147](https://github.com/FilOzone/dealbot/issues/147)) ([6392272](https://github.com/FilOzone/dealbot/commit/6392272e8e38970495e4f55a372c6ee17faf6d17))
* deal overhaul ([#175](https://github.com/FilOzone/dealbot/issues/175)) ([40f9801](https://github.com/FilOzone/dealbot/commit/40f98012bba5909a88c657ca543c1f82f6514207))


### Bug Fixes

* allow always enabling IPNI testing ([#157](https://github.com/FilOzone/dealbot/issues/157)) ([0e5f10f](https://github.com/FilOzone/dealbot/commit/0e5f10f1376ac23277a9b3266b9bd1ddb81a97f4))
* dev-tool for testing deals+retrievals on-demand ([#167](https://github.com/FilOzone/dealbot/issues/167)) ([768263e](https://github.com/FilOzone/dealbot/commit/768263e33c3be530d38c199750bc10c32e9e45b6))
* do not wait so long for piece and ipni status ([#182](https://github.com/FilOzone/dealbot/issues/182)) ([bf16a19](https://github.com/FilOzone/dealbot/commit/bf16a1963d80087941e72f6b97a865719181bf24))
* ensure synapse-sdk errors are caught ([#179](https://github.com/FilOzone/dealbot/issues/179)) ([ad5aa55](https://github.com/FilOzone/dealbot/commit/ad5aa55655de2db88e4ffc585d7c24876854c6bd))
* import getPieceStatus logic ([#166](https://github.com/FilOzone/dealbot/issues/166)) ([8e5695b](https://github.com/FilOzone/dealbot/commit/8e5695b1fc49921537808baf9b5f5afcfd8d0d9c))
* **metrics:** export prometheus providers and proxy /metrics ([#161](https://github.com/FilOzone/dealbot/issues/161)) ([33612e4](https://github.com/FilOzone/dealbot/commit/33612e495da63fe0d3b75bc0b1f3ad2643027a95)), closes [#147](https://github.com/FilOzone/dealbot/issues/147)
* prevent upsert DB failure on duplicate SPs ([#156](https://github.com/FilOzone/dealbot/issues/156)) ([d49d614](https://github.com/FilOzone/dealbot/commit/d49d614d4b9ccf08a69bbfd58e33b870380e7fe6))
* remove kaggle/local dataset handling ([#183](https://github.com/FilOzone/dealbot/issues/183)) ([53032e1](https://github.com/FilOzone/dealbot/commit/53032e15f996bce1e94759c26f5c816597adec05))

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
