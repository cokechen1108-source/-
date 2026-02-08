# Minara Tweets Scored

Minara Creator Leaderboard — 基于推文内容质量和交易表现对创作者进行多维度评分与排名，内置反垃圾 / 反刷分机制。

## 项目概述

本项目围绕 **Minara IP** 生态，对创作者（Creator）发布的推文和关联交易数据进行量化评分，最终生成一个综合排行榜。支持中英文混合推文分析，包含内容打分、衍生影响力打分、情绪分析和反垃圾检测四大核心模块。

## 核心功能

### 1. 创作者排行榜（Creator Leaderboard）

按总分降序排列，展示每位创作者的各维度得分详情。

### 2. 多维度内容评分

对每位创作者的推文集合从四个维度进行独立打分，再加权汇总。

### 3. 衍生影响力评分

基于创作者原创推文的转推传播量与粉丝基数，衡量内容扩散能力。

### 4. 中英混合情绪分析

轻量级关键词匹配的情绪打分器，支持中文、英文和 emoji。

### 5. 反垃圾 / 反刷分系统

多层防御机制，有效筛选羊毛党和低质量刷量行为：

- **Spam 信号检测**：识别极短内容、纯 emoji、全大写、低质量模板等 spam 模式
- **近似去重**：基于 Jaccard 相似度检测模板化内容，防止换词刷量
- **账号可信度**：基于粉丝数的可信度系数，小号 / 新号自动打折
- **零互动降权**：无任何互动的推文不贡献正分

---

## 评分算法详解

### 评分流程总览

```
推文列表
  │
  ▼
Phase 0: Spam 检测 ──→ 标记垃圾推文，计算 spamPenalty
  │
  ▼ (仅有效推文参与后续打分)
Phase 1: Originality ──→ 近似去重（Jaccard ≥ 0.7）
Phase 2: Insight     ──→ 文本长度 + 深度关键词 + 词汇多样性
Phase 3: Engagement  ──→ 连续化互动质量（soft normalize）
Phase 4: Affinity    ──→ Minara 关键词安全全词匹配
Phase 5: Credibility ──→ 粉丝可信度系数
  │
  ▼
加权汇总 × spamPenalty × credibility ──→ Content Score
  │
  ▼
Content Score × 0.6 + Derivative Score × 0.4 ──→ Total Score
```

---

### 零、Spam 检测（Phase 0）

在评分之前，先对每条推文进行 spam 信号检测，输出一个 `[0, 1]` 的 spam 概率值。

| 信号 | 判定条件 | 权重 |
|------|----------|------|
| 极短内容 | 文本 < 15 字符 | +0.30 |
| 低质量模板 | 命中预设模式（gm、soon、wagmi、冲就完了 等） | +0.25 |
| Emoji 过载 | emoji / 特殊字符占比 > 50% | +0.20 |
| 全大写 | 英文部分 > 5 字母且全大写 | +0.15 |
| 过度重复 | 同一字符连续出现 5 次以上 | +0.10 |

**低质量模板匹配规则：**

```
gm, gn, go/let's go, soon, wen, wagmi, ngmi, (to the) moon,
retweet pls, like pls, follow me,
冲/再冲, 冲就完了, 买买买,
纯 emoji 组合（🚀🔥💎🌙✨💰）
```

**spam score >= 0.5 的推文标记为垃圾推文**，不参与后续评分。

垃圾推文占比影响整体惩罚系数：

```
spamPenalty = max(0, 1 - spamRatio × 0.7)
```

其中 `spamRatio = 垃圾推文数 / 总推文数`。示例：50% 垃圾推文 → penalty ≈ 0.65。

---

### 一、Content Score（内容评分）

内容评分由 **4 个子维度** 组成，每个子维度的分值范围为 `[0, 100]`。

#### 1.1 Originality Score（原创性得分）— 权重 25%

衡量推文的原创比例，使用 **Jaccard 近似去重**替代精确去重。

```
originalityScore = (原创且不近似重复的推文数 / 有效推文数) × 100
```

**判定规则：**
- 标记为 `isRetweet` 的推文直接排除
- 新推文与已有推文的 **Jaccard 相似度 >= 0.7** 时视为近似重复
- 即使换了几个词，模板化内容也会被识别

**Jaccard 相似度：**
```
J(A, B) = |A ∩ B| / |A ∪ B|
```
其中 A、B 为两条推文的 token 集合（简单分词：按空格 + 标点拆分，去除单字符 token）。

#### 1.2 Insight Score（洞察力得分）— 权重 35%

衡量推文的信息密度，基于文本长度、深度关键词命中和词汇多样性进行离散打分。

对每条非转推推文累加得分（上限 100 分/条）：

| 条件 | 加分 |
|------|------|
| 文本长度 > 60 字符 | +20 |
| 文本长度 > 120 字符 | +10 |
| 包含 `为什么` 或 `thesis` | +30 |
| 包含 `narrative` 或 `世界观` | +30 |
| 包含 `逻辑` 或 `analysis` | +15 |
| 包含 `thread` 或 `🧵` | +15 |
| 词汇多样性（unique tokens / total tokens）> 0.7 | +10 |

最终 `insightScore = avg(每条推文得分)`。

#### 1.3 Engagement Quality Score（互动质量得分）— 权重 25%

衡量推文获得的互动质量，转推权重最高。

对每条非转推推文计算加权原始互动值：

```
rawEngagement = likes × 1 + replies × 2 + retweets × 3
```

**关键规则：**
- **零互动推文不贡献正分**（但参与平均分母，拉低均值）
- 使用 **soft normalize**（对数归一化）避免离群值主导：

```
perTweetEngagement = min(1, log(1 + rawEngagement) / log(1 + 300))
```

其中 `300` 为 soft cap pivot 值。最终 `engagementQualityScore = avg(perTweetEngagement) × 100`。

#### 1.4 Minara Affinity Score（Minara 亲和度得分）— 权重 15%

衡量推文与 Minara IP 的关联程度。

```
minaraAffinityScore = (包含 Minara 关键词的推文数 / 总推文数) × 100
```

**Minara 关键词列表：**

```
minara, 米娜拉, fan art, 二创, 衍生创作, 同人
```

**关键优化：** 英文关键词使用 **全词匹配（word boundary）**，避免 "tip"、"drip" 等误中。已移除过于宽泛的 "ip"。

#### 1.5 Total Content Score（内容总分）

四个子维度的加权求和，再乘以惩罚和可信度系数：

```
rawTotal = Originality × 0.25
         + Insight    × 0.35
         + Engagement × 0.25
         + Affinity   × 0.15

totalContentScore = rawTotal × spamPenalty × credibility
```

---

### 二、账号可信度系数（Credibility）

基于粉丝数的 soft cap 可信度评估，防止羊毛党批量注册小号刷分。

```
credibility = 0.3 + 0.7 × min(1, log(1 + followers) / log(1 + 5000))
```

| 粉丝数 | 可信度系数 |
|--------|-----------|
| 0 | 0.30 |
| 100 | ~0.68 |
| 1,000 | ~0.85 |
| 5,000 | ~0.95 |
| 10,000+ | ~1.00 |

---

### 三、Derivative Score（衍生影响力评分）

基于创作者原创推文获得的转推量与其粉丝基数的比率，衡量内容扩散能力。

```
derivativeScore = (原创推文总转推数 / 粉丝数) × 1000
```

| 场景 | 说明 |
|------|------|
| 粉丝数为 0 | 直接返回 0 |
| 转推/粉丝比高 | 说明内容穿透力强，得分高 |
| 转推/粉丝比低 | 内容传播有限，得分低 |

---

### 四、Total Score（综合总分）

```
totalScore = contentScore × 0.6 + derivativeScore × 0.4
```

内容贡献占 60%，衍生影响力占 40%。

---

### 五、Sentiment Analysis（情绪分析）

轻量级基于关键词匹配的情绪打分器，输出范围 `[-3, +3]`，作为 Insight Score 的辅助信号使用。

| 类型 | 关键词 |
|------|--------|
| 积极 (+1 each) | `🚀`, `moon`, `win`, `赚`, `爽`, `机会`, `稳`, `happy`, `nice`, `cool`, `lol` |
| 消极 (-1 each) | `跌`, `亏`, `risk`, `怕`, `崩`, `爆仓`, `loss`, `rip` |

每命中一个关键词 +1 或 -1，最终 clamp 到 `[-3, 3]`。

---

## 反垃圾效果示例

| 创作者类型 | 总分 | Spam Penalty | 有效推文 | 关键过滤机制 |
|-----------|------|-------------|---------|------------|
| 优质创作者（12800 粉） | **58.54** | 1.00 | 3/3 | 无惩罚，全部有效 |
| 普通用户（1200 粉） | **31.62** | 0.88 | 3/3 | 粉丝可信度轻微折扣 |
| 模板刷量（120 粉） | **14.12** | 0.69 | 5/5 | Jaccard 去重 → 原创性仅 20% |
| 短文刷量（45 粉） | **9.93** | 0.45 | 5/8 | 3 条被过滤 + 小号惩罚 |
| 转推刷量（80 粉） | **7.43** | 0.57 | 4/5 | 转推排除 + 低质量过滤 |

---

## 评分算法一览图

```
Creator Total Score
├── Content Score (权重 60%)
│   ├── Originality Score    (25%)  ← Jaccard 近似去重（阈值 0.7）
│   ├── Insight Score        (35%)  ← 长度 + 深度关键词 + 词汇多样性
│   ├── Engagement Quality   (25%)  ← likes×1 + replies×2 + retweets×3
│   ├── Minara Affinity      (15%)  ← 安全全词匹配
│   │
│   ├── × Spam Penalty             ← 垃圾推文比例惩罚
│   └── × Credibility              ← 粉丝可信度系数
│
└── Derivative Score (权重 40%)
    └── (原创推文总转推数 / 粉丝数) × 1000
```

## License

Private project.
