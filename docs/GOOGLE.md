# Google Maps 与 Grab 的接入方式

## v4 已实现

本页维护自己的地点清单与公开坐标。Google Maps 按钮打开门店查询，供用户查看照片、评价和分店。路线与核对落点使用单独按钮。
已核对的 Google Maps 分享链接可保存到 googleMapsUrl；已核对的 Place ID 可保存到 googlePlaceId。两者都没有时，使用店名、街道和城市查询，结果需由用户核对。
Google Maps URLs 不需要 API 密钥。本版没有直接抓取、下载或内嵌 Google 照片，没有调用付费接口。
官方说明：https://developers.google.com/maps/architecture/maps-url

## 直接显示 Google 商家信息或照片

Google Places API 可以提供商家信息、照片、评价等，但需启用计费并配置密钥或合适的授权。收费依实际调用、字段和适用免费额度决定。
在地图中显示 Places 数据须遵守 Google 地图展示要求；照片作者署名、Google 标识、评价署名与缓存限制也需要处理。当前 OSM 地图不直接叠加 Google Places API 返回的商家内容。
本轮未开通任何付费服务，未添加任何 API 密钥。后续需要嵌入照片时，先确定授权、预算和合规展示方式。
用量与计费：https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
内容与展示政策：https://developers.google.com/maps/documentation/places/web-service/policies

## Grab 目的地

本页以地点坐标生成完整 Plus Code，仅把代码本身复制到剪贴板。用户在 Grab 的目的地框粘贴后，核对图钉再叫车。
Grab 越南官方地点码说明：https://www.grab.com/vn/macong/
门店名称、街道地址和地点信息有独立的复制按钮，避免混在一段文字里影响搜索。
完整地点码无需依靠短码的城市上下文。没有可信坐标的记录不生成代码；代码本身不会提高原坐标的可靠程度。
当车辆入口另有已核对位置，可填写 dropoff，叫车目的地使用该入口，门店照片仍指向原门店。

## Plus Code 算法与验证

来源：https://github.com/google/open-location-code/tree/83986da0156bbf51fba33d0327d8ca4b7f955c89
运行时使用 assets/plus-code.mjs，基于上述版本的整数编码实现，并对十进制边界做精确缩放。
测试保留上游原始302条编码向量与未修改的 JavaScript 解码器。许可为 Apache-2.0，见 vendor/OPEN-LOCATION-CODE-LICENSE。
实际 Grab 应用的搜索结果、车辆可达入口和订单均未由自动测试验证；本轮没有下单、付款或订车。
