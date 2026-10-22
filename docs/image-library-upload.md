# 图片素材库接入

[返回使用指南](README.md) · [AI 选图与下载](webmcp.md)

## 使用现有素材

图形库提供分类、用途、色态和关键词搜索；选中素材可查看 ID、描述和尺寸。图片类型说明见 [基础／拉伸](image-stretch.md)。素材数据更新后点击分类旁的「刷新」。

描述与用途数据不可用时仍可浏览基础目录和搜索 ID；服务暂不可达时可以使用已有浏览器缓存。基本形状和已有画布不依赖全库加载成功。

## 维护素材服务

默认图片源为 `https://oss.070077.xyz/images`，目录结构：

```text
images/
  data.json
  desc.json
  category.json
  i18n/zh-cn.json
  i18n/en-us.json
  sprite/<ID>.png
  border/<ID>.json
  stretch/data.json
  stretch/<已登记的预览文件>
```

- `data.json`：图片 `id/img/border` 与分类成员，必要文件。
- `desc.json`：以素材 ID 补充 `description/uses`。
- `category.json`：用途分组、名称、关键词及 `filters`（中间用途到细分用途的映射）。分类数量以当前数据为准。
- `border/<ID>.json`：原图尺寸和切片边框；不能仅凭边框文件存在就判断支持拉伸。
- `stretch/data.json`：已登记的预渲染缩略图索引，不替代原图或边框。

应用通过后端合并 JSON，浏览器缓存已有结果；生产数据不打包进源码。更新对象后刷新相应 CDN 缓存，再在编辑器刷新目录。JSON 使用 `application/json`，图片使用 `image/png`。

分类名称、描述、用途和拉伸预览为可选补充；缺少时只影响相应功能，不应提供伪造的生产目录兜底。自定义服务地址需要同时核对前后端配置，见 [部署配置](deploy.md#可选配置)。

## 下载素材包

WebMCP `prepare_asset_pack` 返回下载请求或链接。ZIP 包含 `images/` 原图、`manifest.json` 和带 ID 的 `contact-sheets/` 总览；失败素材会留在清单中。

也可运行项目提供的通用脚本：

```bash
python skills/miliastra-image-asset-selector/scripts/download_asset_pack.py --base-url http://127.0.0.1:8439 --ids 100006 100001 --output asset-pack
```

脚本从仓库根目录运行，下载并检查路径后解压；需要全库时使用 `--all` 替代 `--ids`。更多例子见 [素材选择技能](../skills/miliastra-image-asset-selector/SKILL.md)。
