# Minara Tweets Scored

Minara Creator Leaderboard：基于真实推文质量、传播表现和媒体证据（OCR）对创作者进行多维评分与排名。

---

## 1. 项目目标

该项目用于回答一个核心问题：

> 一个创作者在 Minara 生态里的内容质量和真实影响力，能否被量化、可解释、可对比？

当前系统支持：

- Mock 数据评分（本地演示）
- 真实 Twitter/X 链接评分（`/api/analyze-links`）
- 媒体识别（含 OCR + PNL 证据注入）
- 排行榜与细粒度评分拆解展示

---

## 2. 评分流程总览（与代码一致）

评分主入口：`lib/score/creatorScore.ts`

```text
输入：某创作者 tweets + followers
  -> Phase 0: 每条推文计算 spamWeight / timeWeight（软惩罚，不是硬剔除）
  -> 仅非转推推文进入主维度计算（effective tweets）
  -> Phase 1: Originality（Jaccard 近似去重）
  -> Phase 2: Insight（深度连续打分 + 媒体加成）
  -> Phase 3: Engagement（互动质量 + 反刷可信度）
  -> Phase 4: Influence（覆盖/对话/扩散/穿透 + 媒体加成）
  -> Phase 4.5: PNL 证据维度（OCR识别分档）
  -> Phase 5: 乘数项（spamPenalty × credibility × burstPenalty）
  -> ContentScore
  -> DerivativeScore（retweet/reply/quote 三信号）
  -> TotalScore（Content 60% + Derivative 40%，有PNL时动态注入）
```

---

## 3. 核心常量

定义位置：`lib/score/creatorScore.ts`

- `JACCARD_DUP_THRESHOLD = 0.7`（近似重复阈值）
- `FOLLOWER_CREDIBILITY_PIVOT = 5000`（粉丝可信度 soft cap）
- `SAMPLE_SMOOTH_N0 = 5`（小样本参考阈值，仅展示）
- `HALF_LIFE_DAYS = 30`（时间衰减半衰期）

---

## 4. Content Score 详解

### 4.1 预处理与有效样本

对每条推文计算：

- `spamWeight = max(0, 1 - spamScore)`
- `timeWeight = exp(-ln(2) * ageDays / HALF_LIFE_DAYS)`
- 基础权重：`baseWeight = max(0.05, spamWeight) * max(0.2, timeWeight)`

仅 `!isRetweet` 的推文进入主评分，记为 `effectiveTweetCount`。

> 说明：这是“软惩罚 + 软加权”体系，不是简单删除异常样本。

---

### 4.2 Originality（原创性，0~100）

逻辑：按 token 集进行 Jaccard 相似度去重。

当某条推文与历史已保留推文相似度 `>= 0.7` 时视作近似重复，不计入原创权重。

公式：

```text
originalityScore = originalityWeight / weightSum * 100
```

---

### 4.3 Insight（深度，0~100）

按推文逐条计算连续深度分，再按 `baseWeight` 加权平均。

主要信号：

- 文本长度归一化（pivot=220）
- 关键词命中（thesis / narrative / logic / thread）
- 词汇多样性（unique/total）
- 语义密度（关键词命中数除以 sqrt(token数)）
- 媒体加成：
  - OCR 文本长度
  - `data_snapshot` 标签
  - `mediaDepthBoost`

关键词配置来自：`lib/score/keywordConfig.ts`（版本 `KEYWORD_CONFIG_VERSION`）。

---

### 4.4 Engagement Quality（互动质量，0~100）

单条推文原始互动值：

```text
raw = likes + replies*2 + retweets*3 + quotes*2.5
```

先做 log 归一化：

```text
normalized = min(1, log1p(raw) / log1p(300))
```

再做反刷可信度折扣：

```text
baseline = max(20, sqrt(followers)*6)
anomalyRatio = raw / baseline
interactionCredibility = anomalyRatio<=1 ? 1 : max(0.25, 1/sqrt(anomalyRatio))
```

最终按 `baseWeight` 聚合得到 `engagementQualityScore`。

阅读量在该维度中以低权重辅助注入（约 8%），并附带可信度折扣：

- 目的：在不放大刷量风险的前提下，补充“被看到”的信息
- 约束：若出现“高阅读但极低互动率”，阅读信号会被折损（防刷）

---

### 4.5 Influence（影响力，0~100）

这是当前版本里“真实传播影响力”维度（字段名沿用 `minaraAffinityScore`）。

单条推文影响力由四项组成：

- 覆盖规模 `reachSignal`（pivot=800）
- 对话带动 `conversationSignal`（pivot=120）
- 再传播 `reshareSignal`（pivot=180）
- 粉丝穿透 `penetrationSignal`（每千粉互动，pivot=30）

并加入低权重阅读补充信号：

- `viewSignal`（阅读规模 + 每粉阅读穿透，约 8%）
- 同样经过阅读可信度折扣，避免“纯曝光刷量”抬分

并加入媒体加成：

- `mediaInfluenceBoost`
- `fanart` 标签额外加成

再进行小样本置信回归：

```text
influenceConfidence = n / (n + 2)
finalInfluence = (influenceRaw * influenceConfidence + 0.25 * (1 - influenceConfidence)) * 100
```

---

### 4.6 PNL 证据维度（OCR 注入）

来源：`pages/api/analyze-links.ts`

系统会对图片媒体进行 OCR（支持超时、预算和缓存），从 OCR/alt_text 里提取收益语义：

- 识别关键词：`pnl/profit/收益/盈利/...`
- 提取金额并分档：
  - `<100` => 25
  - `100~500` => 50
  - `500~1000` => 75
  - `>=1000` => 100

聚合后得到：

- `pnlEvidenceScore`
- `pnlEvidenceCoverage`（有证据推文占比）

---

### 4.7 Content 总分

四个子维度先线性组合：

```text
rawTotal =
  originality*0.25 +
  insight*0.35 +
  engagement*0.25 +
  influence*0.15
```

再乘三类质量乘数：

```text
credibility = 0.3 + 0.7 * min(1, log1p(followers)/log1p(5000))
finalMultiplier = spamPenalty * credibility * burstPenalty
contentScore = round(rawTotal * finalMultiplier)
```

其中：

- `spamPenalty = avg(spamWeight)`
- `burstPenalty`：30分钟窗口内突发频率惩罚；若 burst>5，使用 `max(0.35, 5/burst)`
- `sampleFactor = min(1, n/5)` **仅用于展示，不再直接压制分数**（已保证单条理论上限可达 100）

---

## 5. Derivative Score（衍生分）

仅基于原创推文汇总：

```text
retweetSignal = softNormalize((totalRetweets/followers)*1000, 120)
replySignal   = softNormalize((totalReplies/followers)*1000, 60)
quoteSignal   = softNormalize((totalQuotes/followers)*1000, 40)

derivativeScore = (retweetSignal*0.5 + replySignal*0.3 + quoteSignal*0.2) * 100
```

这比旧版“只看转推”更稳定，能反映讨论与引用传播。

---

## 6. Total Score（总分）

基础总分：

```text
baseScore = contentScore*0.6 + derivativeScore*0.4
```

主题硬门槛（防止贴无关历史推文刷分）：

- 若推文不满足 Minara 主题识别，则不参与 `contentScore / derivativeScore`
- 若某创作者在本次输入中无任何有效 Minara 主题推文，则 `totalScore = 0`

Minara 主题识别规则：

- 推文正文包含 `minara` 或 `米娜拉`
- 或媒体 `OCR/alt_text` 中包含 `minara` 或 `米娜拉`

若存在 PNL 证据（`pnlEvidenceCoverage > 0`），动态注入第三维：

```text
pnlWeight = min(0.12, 0.06 + 0.06 * pnlEvidenceCoverage)
totalScore = baseScore*(1-pnlWeight) + pnlEvidenceScore*pnlWeight
```

若无 PNL 证据，则 `totalScore = baseScore`。

---

## 7. 媒体识别与 OCR 机制

实现位置：`pages/api/analyze-links.ts`

### 7.1 媒体标签

系统从 alt_text + OCR 文本中识别：

- `data_snapshot`
- `fanart`
- `chart`

并生成：

- `mediaDepthBoost`
- `mediaInfluenceBoost`

### 7.2 性能保护

- `OCR_TIMEOUT_MS`（默认 8000ms）
- `MAX_OCR_IMAGES_PER_TWEET`（默认 2）
- `MAX_OCR_IMAGES_TOTAL_PER_REQUEST`（默认 3）
- `OCR_CACHE`（按图片 URL 缓存 OCR 结果）

---

## 8. 返回字段（前端可解释性）

关键输出类型：`types/leaderboard.ts`

- `contentScore / derivativeScore / totalScore`
- `depthScore / engagementScore / influenceScore / activityScore`
- `contentBreakdown`（含 `spamPenalty`、`credibility`、`finalMultiplier`、`pnlEvidenceScore` 等）
- 真实分析接口额外返回：
  - `analysisMeta`
  - `creatorTweetDetails`（每条推文的 rawEngagement、influenceSignals、mediaInsights 等）

---

## 9. 环境变量（评分相关）

`.env.local` 常用项：

- `TWITTER_BEARER_TOKEN`
- `ENABLE_IMAGE_OCR`（`false` 可关闭OCR）
- `OCR_LANG`（默认 `eng`）
- `OCR_TIMEOUT_MS`
- `MAX_OCR_IMAGES_PER_TWEET`
- `MAX_OCR_IMAGES_TOTAL_PER_REQUEST`

---

## 10. 快速验证

### Mock 排行榜

- 打开首页，默认使用 mock creators 评分。

### 真实推文评分

1. 配置 `TWITTER_BEARER_TOKEN`
2. 前端输入 `x.com/<user>/status/<id>` 链接
3. 点击“真实推文评分”
4. 查看总分 + 明细拆解 + 媒体识别结果

---

## 11. 版本说明与注意事项

- 当前算法关键词版本：`2026-02-v1`
- 文档以代码为准，核心实现：
  - `lib/score/creatorScore.ts`
  - `pages/api/analyze-links.ts`
  - `lib/score/keywordConfig.ts`

> 如果后续调整权重/阈值/分档，建议同步更新本 README 对应章节，保持“算法可解释”。

---

## License

Private project.
