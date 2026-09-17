# 公众号文章采集

素材采集面板支持通过付费数据服务搜索公开公众号文章，并将确认后的正文写入当前文章的 `materials.md`。

## 支持的服务

### TikHub

- 搜索接口：`POST /api/v1/wechat_search/v2/fetch_search`
- 正文接口：`POST /api/v1/wechat_mp/v2/fetch_article_detail_h5`
- 服务端环境变量：`TIKHUB_API_KEY`
- 文档：[TikHub 微信综合搜索](https://docs.tikhub.io/472974860e0)

搜索固定使用文章垂类 `business_type=article` 和精简响应 `raw=false`。支持相关度、最新、热度排序，以及不限时间、一天、七天、半年筛选。

### 极致了数据

- 搜索接口：`POST /fbmain/monitor/v3/web_search`
- 正文接口：`POST /fbmain/monitor/v3/article_detail`（Pro）
- 服务端环境变量：`DAJIALA_API_KEY`
- 文档：[极致了数据 API](https://www.dajiala.com/main/interface?actnav=0)

搜索固定使用 `search_type=1` 文章类目。排序和时间范围会转换为服务商要求的数字枚举。

## 使用

1. 在 `web/.env` 中配置至少一个服务商密钥。
2. 重启后端。
3. 打开文章编辑器的“素材”步骤。
4. 在左侧选择“公众号采集”，选择已配置的服务商后搜索。
5. 先根据摘要筛选文章；需要正文时点击“读取正文”。
6. 勾选需要的文章并写入素材库。

搜索和正文读取都可能产生服务商费用，界面会在操作前显示对应费用提示。服务商密钥只在服务端读取，不会返回浏览器或写入日志。

## 边界

- 仅接收公开的 `https://mp.weixin.qq.com/s/...` 文章链接。
- 第三方服务的覆盖范围、计费和稳定性由服务商决定。
- 平台不会自动重试付费请求，避免一次操作产生多次费用。
- TikHub 使用其推荐的 H5 正文接口；极致了数据使用纯文本文章详情接口。
