[English](README.md)

# Ask W3C i18n

Ask W3C i18n是一个关于W3C国际化的问答工具，基于源文档提供答案并附有引用和来源的状态。

<p align="center">
  <a href="https://i18n-drafts-assistant.onrender.com/"><strong>在线版在这里</strong></a>
</p>

> **实验性工具：** 本项目是[W3C国际化标准计划](https://www.w3.org/International/)的实验性工具，回答不代表W3C标准或W3C官方立场。

## 示例问题

- 如何在HTML中设置内容的语言？
- 如何在HTML中声明UTF-8编码？
- 什么是字符集？
- 什么是BOM？
- 什么是ruby？
- 国际化工作组都做什么？
- 当HTTP Content-Type、BOM和`<meta charset>`不一致时，哪个里面的编码优先？
- 为什么我的阿拉伯语文本出现的顺序不对？

## 本地运行

使用本地源：

```sh
cp .env.example .env
# 编辑 .env，设置 SOURCE_MODE=local 和 SOURCE_REPO_PATH

npm run index
npm run start
```

使用默认的远程源：

```sh
SOURCE_MODE=git npm run index
npm run start
```

打开 http://127.0.0.1:3000 即可。

## 配置

应用从项目根目录自动加载`.env`。本地开发时复制`.env.example`为`.env`，然后编辑其中的值。

不要提交真实的`.env`文件或密钥。

重要默认值：

- `SOURCE_MODE=git`
- `SOURCE_REPO_URL=https://github.com/w3c/i18n-drafts.git`
- `SOURCE_REF=gh-pages`
- `SOURCE_CACHE_DIR=.cache/source/i18n-drafts`
- `PUBLIC_BASE_URL=https://www.w3.org/International`
- `MODEL_PROVIDER=local`
- `TRUSTED_PROXIES=`（默认为空；忽略转发的客户端IP头）
- `BASE_PATH=`（默认为空；设为`/ask-i18n`之类的子路径即可把应用部署在站点根路径之下）

`.env.example`中的`SOURCES`配置示例启用了`i18n-drafts`、`bp-i18n-specdev`和`i18n-activity`的多源索引。其中`i18n-activity`源仅限于`i18n-wg`和`i18n-ig`文件夹。

`SOURCES`会覆盖单源`SOURCE_*`设置。如果只想使用本地`i18n-drafts`检出，请先删除或注释掉`SOURCES`，再设置`SOURCE_MODE=local`和`SOURCE_REPO_PATH`。

`MODEL_PROVIDER=local`使用基于检索片段的确定性抽取式问答。要使用外部服务端模型，请设置：

```sh
MODEL_PROVIDER=openai-compatible
MODEL_API_KEY=...
MODEL_BASE_URL=https://api.openai.com/v1
GENERATION_MODEL=...
MODEL_TIMEOUT_MS=30000
```

API密钥仅由Node服务器读取，不会发送到浏览器。

对于部署在反向代理或CDN后的场景，设置`TRUSTED_PROXIES`为允许设置`Forwarded`或`X-Forwarded-For`头的代理IP或CIDR范围：

```sh
TRUSTED_PROXIES=127.0.0.1/32,::1
```

当此值未设置时，速率限制仅使用直连socket地址，以防止公共客户端伪造转发IP头绕过限制。

## 部署在子路径下

如果应用挂在站点根路径之下，例如通过labs代理部署在`https://labs.w3.org/ask-i18n/`，需要设置`BASE_PATH`：

```sh
BASE_PATH=/ask-i18n
```

此时界面和API都通过该前缀访问（`/ask-i18n/`、`/ask-i18n/api/v1/search`），直接访问不带斜杠的前缀会重定向到`/ask-i18n/`，以保证页面里的相对资源路径能正确解析。仅有相同前缀的其他路径（如`/ask-i18n-drafts/`）不受影响。

两种代理方式都支持。如果代理转发前会剥掉前缀，保持`BASE_PATH`为空，应用继续在根路径提供服务；如果代理转发完整路径，则把`BASE_PATH`设为挂载的前缀。两种情况下不带前缀的路径都能继续访问，因此同一份代码既能在本地端口也能在子路径下运行。

## 命令

```sh
npm test
npm run test:e2e
npm run index
npm run rag:index
npm run eval
npm run start
```

用于fixture开发：

```sh
npm run index -- --source-mode=local --source-repo-path=tests/fixtures/i18n-mini
npm run eval
```

Playwright E2E 测试使用同样的 fixture 语料，并启动真实服务。先安装一次浏览器：
`npx playwright install chromium firefox webkit`，然后运行 `npm run test:e2e`。

## 社区API

稳定的社区API版本为`/api/v1`，使用已加载的最新索引。

OpenAPI文档可通过以下地址获取：

```sh
curl https://i18n-drafts-assistant.onrender.com/api/openapi.json
```

搜索已索引的源文档章节：

```sh
curl "https://i18n-drafts-assistant.onrender.com/api/v1/search?q=declare%20UTF-8&language=en&status=published&limit=5"
```

搜索返回排序的摘要片段，而非完整的调试块：

```json
{
  "query": "declare UTF-8",
  "results": [
    {
      "id": "articles/http-charset/index.en.html#charset",
      "rank": 1,
      "score": 1.23,
      "title": "Declaring character encodings in HTML",
      "url": "https://www.w3.org/International/articles/http-charset/#charset",
      "language": "en",
      "status": "published",
      "translation_state": "current",
      "snippet": "For HTML pages, use UTF-8..."
    }
  ],
  "index": {
    "source_ref": "gh-pages",
    "source_commit": "..."
  }
}
```

回答问题并附有引用：

```sh
curl -X POST https://i18n-drafts-assistant.onrender.com/api/v1/answer \
  -H "content-type: application/json" \
  -d '{"question":"How should I declare UTF-8 character encoding?","language":"en","statuses":["published"]}'
```

Answer响应的结构如下：

```json
{
  "question": "How should I declare UTF-8 character encoding?",
  "language": "en",
  "evidence_status": "supported",
  "answer": "... [1]",
  "citations": [
    {
      "id": "articles/http-charset/index.en.html#charset",
      "label": "Declaring character encodings in HTML: The charset parameter",
      "url": "https://www.w3.org/International/articles/http-charset/#charset",
      "language": "en",
      "status": "published",
      "translation_state": "current",
      "source_path": "articles/http-charset/index.en.html",
      "rank": 1
    }
  ],
  "warnings": [],
  "index": {
    "source_ref": "gh-pages",
    "source_commit": "..."
  }
}
```

支持的过滤参数：

- `language`：首选BCP 47语言标签，默认为`en`。
- `status`或`statuses`：可选值为`published`、`review`、`draft`、`notreviewed`、`obsolete`中的一个或多个。
- `include_obsolete`：设为`true`以包含已废弃的资源。
- `limit`：最大检索结果数，上限为`20`。

错误使用标准对象：

```json
{
  "error": {
    "code": "index_unavailable",
    "message": "No search index is available. Run npm run index first.",
    "language": "en",
    "direction": "ltr"
  },
  "index": {
    "source_ref": "gh-pages",
    "source_commit": "..."
  }
}
```

`error.language`是`error.message`的BCP 47语言标签；`error.direction`是消息文本方向（`ltr`或`rtl`），以便阿拉伯语等消息可以正确渲染。

社区API已启用CORS。所有`/api/`路由均使用相同的内存速率限制器。

## 内部API

- `GET /api/health`— 返回源模式、ref、commit和索引计数。
- `POST /api/retrieve`— 返回排序后的源文档片段，用于调试和开发。
- `POST /api/ask`— 返回`{ answer, citations, warnings, evidence_status, debug }`。
- `POST /api/admin/reindex`— 隐藏端点，仅在设置了`ADMIN_TOKEN`且请求携带`x-admin-token`时可用。

## 日志

查询日志以JSONL格式存储在`.data/query-log.jsonl`中，记录问题文本、所选语言、过滤条件、检索源ID、证据状态、延迟和错误类型，不存储API密钥或账户标识。日志按大小轮转：文件超过`QUERY_LOG_MAX_BYTES`（默认10 MiB）时重命名为`query-log.jsonl.1`，旧备份依次后移，`QUERY_LOG_BACKUPS`（默认3）限制保留的轮转文件数量。

## 许可证

本项目采用W3C Software and Document License - 2023 version许可。详见`LICENSE`。
