# 点位数据维护

主表：data/places.json。城市表：data/cities.json。地点 ID 保持稳定，改名时继续使用原 ID。
增量文件包含 places 数组，可另带 cities 数组。已有 ID 更新，新 ID 追加；其他记录保留。

每个地点需要 id、name、city、cityName、category。
类别可用 restaurant、sight、cafe、hotel、shopping、transport、other。
普通地点的 awards 为 {}。年份只筛选米其林记录，普通地点继续显示。
描述填写 description 或 food，另可填写 address、tags、source。

未确认坐标时，lat 和 lon 都填写 null：记录留在列表，地图不绘制标记。
确认坐标后，同时填写 coordinateSource、coordinateCheckedAt、positionStatus，保留来源和核对等级。
价格不明时，low 和 high 都填写 null；已知价格则补充人民币区间及 priceBasis、priceDate、priceDetail、charges。
专用 Google 门店分享链接放在 googleMapsUrl；已核对的 Place ID 放在 googlePlaceId。两者都没有时按店名和地址查询。
新增城市需要 id、name、searchName、country、lat、lon。城市中心仅用于浏览城市范围。

dropoff 默认 null。核对车行入口后可填写独立的 lat、lon、label、source、verifiedAt；它仅改变叫车点和路线目标，照片仍指向门店。

## 执行增量更新

`node scripts/upsert-place.mjs change.json` 默认只预览。
`node scripts/upsert-place.mjs change.json --write` 校验后写入本机，并更新数据版本与统计。
然后运行 `npm test && npm run build`，在网页中核对点位和链接，再提交代码。

修改现有记录的结构示例（文字应替换为核实后的内容）：

```json
{ "places": [{ "id": "VN001", "notes": "这里填写已经核实的补充信息" }] }
```

Google Maps 分享链接请保存原始完整链接。URL 中的地图视角中心不一定是商家位置，不能直接当作地点坐标。
地点的门口和能停车的位置可能不同；车辆入口需要单独核对。坐标不明时保持 null。
