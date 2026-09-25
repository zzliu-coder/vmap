# VMap · 越南随行地图 4.0.0

个人旅行地图：看已收录的附近地点 → 在 Google Maps 查看门店、照片和评价 → 复制完整 Plus Code 到 Grab → 核对终点再叫车。

## 日常使用

- 默认收起筛选和地点列表；点击“筛选”、底部“地点列表”展开，点击“收起”恢复地图空间。“清屏”保留大地图与定位，右上角可恢复面板。
- 地点详情包含 Google Maps 门店入口、Grab 地点码、独立复制店名/街道地址、原有价格/年度/来源，以及本浏览器的“想去”。
- “看我附近”按手机或手选位置，显示直线5公里内的已收录地点。可在筛选中调整范围。清单之外的地点需要另外收录。
- 手机定位仅在 HTTPS 网站申请，坐标与轨迹不持久化。“想去”只保存地点 ID，筛选和所选地点保留在当前浏览器会话中。
- Grab 地点码只编码公开坐标。门店、酒店大门与车辆可停靠入口可能不同；出发前检查图钉。没有坐标的记录不生成地点码。

## 数据与后续编辑

- `data/places.json`：唯一的地点主数据。保留原203家餐厅，其中189家有公开坐标；支持餐厅、景点、咖啡、住宿、购物、交通和其他地点。
- `data/cities.json`：城市信息。新增城市后，下拉框自动出现，不再只写死三个城市。
- 按稳定 ID 做增量更新；支持独立的 Google Maps 分享链接 / Place ID，以及有来源、有核对日期的 `dropoff` 下车点。
- `node scripts/upsert-place.mjs change.json` 默认只预览；加 `--write` 才写本机数据。不会自动删除地点、提交或发布。格式见 `docs/POINTS.md`。
- 每次维护：核对来源和门店 → 增量更新 → `npm test && npm run build` → 检查实际页面 → 提交并推送 `main`。

## 本地与部署

`npm ci --ignore-scripts` 安装项目内测试工具，不安装全局工具。`npm run serve` 在 127.0.0.1:47839 预览源码。
`npm test` 检查数据、链接、增量更新及302条上游 Plus Code 编码向量。`npm run build` 校验数据并生成 `dist/`。
`npm run test:browser` 在本机隔离的无头 Chrome 中测试手机/平板/桌面布局；定位与剪贴板使用模拟输入，未操作真实账号。
`VMAP_LIVE_TILES=1 npm run test:browser` 另检查真实联网 OSM 底图。验收输出在 `evidence/`，不提交到仓库。
Vercel 已由用户连接此 GitHub 仓库；`vercel.json` 使用 `npm run build` 和 `dist`，正常推送后由 Vercel 自动部署。无需再创建 Drop 项目。

## Google 数据与许可边界

本版使用免 API 密钥的 Google Maps URLs 跳转；照片/评价在 Google Maps 内看。没有调用付费 Places API、抓取照片、存入 API 密钥或自动建立新商家索引。已预留准确门店链接与 Place ID 字段。
Google Places API 直接接入需启用计费和密钥，并遵守显示、缓存、照片作者署名等要求；详见 `docs/GOOGLE.md`。
原餐厅位置数据署名 Jerry Ng / ngshiheng/michelin-my-maps，CC BY-NC 4.0，仅按个人非商业旅行使用。新增地点需逐项保留来源。
Plus Code 算法来自 Google Open Location Code（Apache-2.0）；使用整数实现并修正十进制边界缩放，已通过同版本全部302条编码向量。许可在 `vendor/`。
`餐厅真实坐标.csv` 与 `检查记录.json` 保留为 v3 历史快照。当前主数据及本轮验收以 `data/`、`docs/ACCEPTANCE.md` 为准。
