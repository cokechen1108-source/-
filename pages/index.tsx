import { GetServerSideProps } from 'next';
import Head from 'next/head';
import { FormEvent, Fragment, useEffect, useMemo, useState } from 'react';

import { getLeaderboard } from '../lib/score/creatorScore';
import { CreatorScoreBreakdown, LeaderboardResponse } from '../types/leaderboard';

interface Props {
  leaderboard: LeaderboardResponse;
}

interface AnalyzeMeta {
  totalSubmittedLinks: number;
  uniqueTweetIds: number;
  fetchedTweets: number;
  unresolvedLinks: number;
  groupedCreators: number;
  keywordConfigVersion: string;
  creatorCoverage: Array<{
    creatorId: string;
    handle: string;
    submittedLinks: number;
    fetchedTweets: number;
    coverage: number;
  }>;
}

interface CreatorTweetDetail {
  tweetId: string;
  text: string;
  createdAt?: string;
  likes: number;
  views: number;
  replies: number;
  retweets: number;
  quotes: number;
  rawEngagement: number;
  normalizedEngagement: number;
  isRetweet: boolean;
  influenceSignals: {
    reach: number;
    conversation: number;
    reshare: number;
    penetration: number;
  };
  mediaInsights: {
    hasMedia: boolean;
    mediaCount: number;
    imageCount: number;
    videoCount: number;
    altTextSummary: string;
    ocrSummary: string;
    mediaDepthBoost: number;
    mediaInfluenceBoost: number;
    mediaTags: string[];
    pnlUSD?: number;
    pnlBucket: 'none' | 'lt100' | '100_500' | '500_1000' | 'gte1000';
    pnlEvidenceScore: number;
    items: Array<{
      mediaKey: string;
      type: string;
      url: string;
      altText?: string;
      ocrText?: string;
      ocrConfidence?: number;
      width?: number;
      height?: number;
      note?: string;
    }>;
  };
  spamScore: number;
  tokenDiversity: number;
  depthSignals: string[];
}

type AnalyzeResponse = LeaderboardResponse & {
  analysisMeta?: AnalyzeMeta;
  creatorTweetDetails?: Record<string, CreatorTweetDetail[]>;
  error?: string;
  details?: string;
};

interface ShareTarget {
  entry: CreatorScoreBreakdown;
  rank: number;
}

export const getServerSideProps: GetServerSideProps<Props> = async () => {
  const leaderboard = getLeaderboard();
  return {
    props: {
      leaderboard
    }
  };
};

export default function Home({ leaderboard }: Props) {
  const [currentLeaderboard, setCurrentLeaderboard] = useState<LeaderboardResponse>(leaderboard);
  const [tweetLinksInput, setTweetLinksInput] = useState('');
  const [savedTweetLinks, setSavedTweetLinks] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [analysisMeta, setAnalysisMeta] = useState<AnalyzeMeta | null>(null);
  const [creatorTweetDetails, setCreatorTweetDetails] = useState<
    Record<string, CreatorTweetDetail[]>
  >({});
  const [expandedCreatorId, setExpandedCreatorId] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [shareImageUrl, setShareImageUrl] = useState('');
  const [shareHint, setShareHint] = useState('');

  const parsedLinks = useMemo(() => parseTweetLinks(tweetLinksInput), [tweetLinksInput]);

  const handleSaveLinks = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (parsedLinks.valid.length === 0) return;

    setSavedTweetLinks((prev) => {
      const merged = new Set([...prev, ...parsedLinks.valid]);
      return Array.from(merged);
    });
    setTweetLinksInput('');
    setAnalyzeError('');
  };

  const handleAnalyzeWithRealTweets = async () => {
    const allLinks = Array.from(new Set([...savedTweetLinks, ...parsedLinks.valid]));
    if (allLinks.length === 0) {
      setAnalyzeError('请先输入至少一条有效推文链接。');
      return;
    }

    setIsAnalyzing(true);
    setAnalyzeError('');

    try {
      const response = await fetch('/api/analyze-links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ links: allLinks })
      });

      const rawText = await response.text();
      let data: Partial<AnalyzeResponse> & { error?: string; details?: string } = {};
      try {
        data = JSON.parse(rawText) as AnalyzeResponse;
      } catch {
        // 接口异常返回HTML时，避免前端直接抛 Unexpected token '<'
        data = {
          error: rawText.startsWith('<!DOCTYPE')
            ? '服务暂时异常（返回了HTML错误页），请稍后重试'
            : '服务返回了非JSON数据'
        };
      }

      if (!response.ok) {
        throw new Error(data.error || data.details || '真实推文评分失败');
      }

      setCurrentLeaderboard(data as LeaderboardResponse);
      setAnalysisMeta((data as AnalyzeResponse).analysisMeta ?? null);
      setCreatorTweetDetails((data as AnalyzeResponse).creatorTweetDetails ?? {});
      setExpandedCreatorId(null);
      setSavedTweetLinks(allLinks);
    } catch (error) {
      const message = error instanceof Error ? error.message : '真实推文评分失败';
      setAnalyzeError(message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (!shareTarget) {
      setShareImageUrl('');
      setShareHint('');
      return;
    }
    let cancelled = false;
    (async () => {
      const image = await renderShareImage(shareTarget.entry, shareTarget.rank);
      if (cancelled) return;
      setShareImageUrl(image);
      setShareHint('');
    })();
    return () => {
      cancelled = true;
    };
  }, [shareTarget]);

  const handleDownloadShareImage = () => {
    if (!shareImageUrl || !shareTarget) return;
    const a = document.createElement('a');
    a.href = shareImageUrl;
    a.download = `${shareTarget.entry.handle.replace('@', '')}-score-share.png`;
    a.click();
  };

  const handleCopyShareImage = async () => {
    if (!shareImageUrl) return;
    try {
      if (!navigator.clipboard || !('write' in navigator.clipboard) || typeof ClipboardItem === 'undefined') {
        throw new Error('当前浏览器不支持直接复制图片');
      }
      const blob = await (await fetch(shareImageUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setShareHint('图片已复制，可直接粘贴到 Twitter/X。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '复制失败';
      setShareHint(`复制失败：${message}`);
    }
  };

  return (
    <>
      <Head>
        <title>创作者排行榜演示</title>
      </Head>
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '40px 16px',
          background:
            'radial-gradient(circle at top, #0f172a 0, #020617 55%, #000 100%)',
          color: '#e5e7eb',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, system-ui, -system-ui, sans-serif'
        }}
      >
        <h1
          style={{
            fontSize: '32px',
            fontWeight: 700,
            marginBottom: 8
          }}
        >
          Creator Leaderboard
        </h1>
        <p
          style={{
            marginBottom: 24,
            color: '#9ca3af'
          }}
        >
          Multi-dimensional creator evaluation
        </p>

        <section
          style={{
            width: '100%',
            maxWidth: 960,
            marginBottom: 16,
            backgroundColor: 'rgba(15,23,42,0.85)',
            borderRadius: 16,
            border: '1px solid rgba(148,163,184,0.25)',
            boxShadow:
              '0 20px 25px -5px rgba(15,23,42,0.8), 0 8px 10px -6px rgba(15,23,42,0.7)',
            padding: '16px'
          }}
        >
          <form onSubmit={handleSaveLinks}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8
              }}
            >
              <h2 style={{ margin: 0, fontSize: 16 }}>推文链接输入</h2>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>
                输入链接后可直接按真实推文评分
              </span>
            </div>

            <textarea
              value={tweetLinksInput}
              onChange={(event) => setTweetLinksInput(event.target.value)}
              placeholder={'每行一个推文链接，例如：https://x.com/user/status/1234567890'}
              style={{
                width: '100%',
                minHeight: 110,
                borderRadius: 10,
                border: '1px solid rgba(71,85,105,0.8)',
                background: 'rgba(2,6,23,0.7)',
                color: '#e5e7eb',
                padding: '10px 12px',
                resize: 'vertical',
                fontFamily: 'inherit',
                fontSize: 14,
                outline: 'none'
              }}
            />

            <div
              style={{
                marginTop: 10,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap'
              }}
            >
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                当前输入有效链接 {parsedLinks.valid.length} 条，非法 {parsedLinks.invalid.length}{' '}
                条
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="submit"
                  disabled={parsedLinks.valid.length === 0}
                  style={{
                    borderRadius: 10,
                    border: '1px solid rgba(71,85,105,0.8)',
                    padding: '8px 14px',
                    color: '#e2e8f0',
                    background:
                      parsedLinks.valid.length === 0
                        ? 'rgba(30,41,59,0.8)'
                        : 'rgba(30,41,59,0.9)',
                    cursor: parsedLinks.valid.length === 0 ? 'not-allowed' : 'pointer',
                    fontWeight: 600
                  }}
                >
                  暂存链接
                </button>
                <button
                  type="button"
                  onClick={handleAnalyzeWithRealTweets}
                  disabled={isAnalyzing}
                  style={{
                    borderRadius: 10,
                    border: '1px solid rgba(59,130,246,0.8)',
                    padding: '8px 14px',
                    color: '#dbeafe',
                    background: isAnalyzing
                      ? 'rgba(30,41,59,0.8)'
                      : 'linear-gradient(90deg, #1d4ed8, #2563eb)',
                    cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                    fontWeight: 600
                  }}
                >
                  {isAnalyzing ? '评分中...' : '真实推文评分'}
                </button>
              </div>
            </div>
          </form>

          {analyzeError && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#fca5a5' }}>{analyzeError}</div>
          )}

          {analysisMeta && (
            <div
              style={{
                marginTop: 12,
                border: '1px solid rgba(71,85,105,0.8)',
                borderRadius: 10,
                padding: '10px 12px',
                background: 'rgba(2,6,23,0.5)'
              }}
            >
              <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 6 }}>
                聚合覆盖率：提交 {analysisMeta.totalSubmittedLinks} 条链接 / 唯一推文 ID{' '}
                {analysisMeta.uniqueTweetIds} / 成功拉取 {analysisMeta.fetchedTweets} / 未解析{' '}
                {analysisMeta.unresolvedLinks} / 词典版本 {analysisMeta.keywordConfigVersion}
              </div>
              <div style={{ fontSize: 12, color: '#93c5fd', lineHeight: 1.6 }}>
                {analysisMeta.creatorCoverage
                  .map(
                    (item) =>
                      `${item.handle} ${item.fetchedTweets}/${item.submittedLinks} (${(
                        item.coverage * 100
                      ).toFixed(0)}%)`
                  )
                  .join(' | ')}
              </div>
            </div>
          )}

          {savedTweetLinks.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 6 }}>
                已暂存推文链接（{savedTweetLinks.length}）
              </div>
              <div
                style={{
                  maxHeight: 130,
                  overflowY: 'auto',
                  border: '1px solid rgba(71,85,105,0.8)',
                  borderRadius: 10,
                  padding: '8px 10px',
                  background: 'rgba(2,6,23,0.6)'
                }}
              >
                {savedTweetLinks.map((link) => (
                  <div
                    key={link}
                    style={{
                      fontSize: 12,
                      lineHeight: 1.6,
                      color: '#93c5fd',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {link}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section
          style={{
            width: '100%',
            maxWidth: 960,
            backgroundColor: 'rgba(15,23,42,0.85)',
            borderRadius: 16,
            border: '1px solid rgba(148,163,184,0.25)',
            boxShadow:
              '0 20px 25px -5px rgba(15,23,42,0.8), 0 8px 10px -6px rgba(15,23,42,0.7)',
            overflow: 'hidden'
          }}
        >
          <header
            style={{
              padding: '12px 20px',
              borderBottom: '1px solid rgba(51,65,85,0.9)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <span
              style={{
                fontSize: 14,
                color: '#9ca3af'
              }}
            >
              更新时间：{new Date(currentLeaderboard.updatedAt).toLocaleString('zh-CN')}
            </span>
          </header>

          <div
            style={{
              padding: '8px 20px 10px',
              borderBottom: '1px solid rgba(51,65,85,0.55)',
              background: 'rgba(2,6,23,0.35)'
            }}
          >
            <details>
              <summary
                style={{
                  cursor: 'pointer',
                  color: '#93c5fd',
                  fontSize: 13,
                  fontWeight: 600
                }}
              >
                算法标准说明（折叠）
              </summary>
              <div style={{ marginTop: 8, fontSize: 12, color: '#cbd5e1', lineHeight: 1.7 }}>
                <div>关注者：作者粉丝数（来自 Twitter/X 用户信息）。</div>
                <div>推文数量：当前参与计算的该作者推文总数。</div>
                <div>
                  内容分：原创性25% + 深度35% + 互动25% + 影响力15%，再乘 spam/可信度/时间与频率惩罚（样本因子仅作参考展示）。
                </div>
                <div>衍生分：retweet/reply/quote 多指标归一化后加权（不再做样本上限截断）。</div>
                <div>深度：长度、深度关键词、词汇多样性等信号的加权结果。</div>
                <div>互动：likes/replies/retweets/quotes 为主，阅读量低权重辅助，含反刷可信度折扣。</div>
                <div>影响力：覆盖/对话/再传播/粉丝穿透为主，阅读补充信号低权重参与。</div>
                <div>活跃度：发帖活跃程度与最终质量乘数的综合。</div>
                <div>总分：仅正文包含 Minara 字样的推文参与计算；无 Minara 字样则直接 0 分。基础为内容分 × 60% + 衍生分 × 40%，若识别到收益截图则注入PNL证据维度（动态权重）。</div>
              </div>
            </details>
          </div>

          <div style={{ width: '100%', overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                minWidth: 1200,
                borderCollapse: 'collapse'
              }}
            >
            <thead
              style={{
                background:
                  'linear-gradient(to right, rgba(15,23,42,0.95), rgba(15,23,42,0.8))'
              }}
            >
              <tr>
                {[
                  'HANDLE',
                  '关注者',
                  '推文数量',
                  '内容分',
                  '衍生分',
                  '深度',
                  '互动',
                  '影响力',
                  '活跃度',
                  '总分'
                ].map((label) => (
                  <th
                    key={label}
                    style={{
                      textAlign: 'left',
                      padding: '10px 16px',
                      fontSize: 12,
                      letterSpacing: 0.08,
                      color: '#9ca3af',
                      borderBottom: '1px solid rgba(51,65,85,0.9)'
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {currentLeaderboard.entries.map((entry, index) => {
                const details = creatorTweetDetails[entry.creatorId] ?? [];
                const expanded = expandedCreatorId === entry.creatorId;
                return (
                  <Fragment key={entry.creatorId}>
                    <LeaderboardRow
                      rank={index + 1}
                      entry={entry}
                      detailCount={details.length}
                      expanded={expanded}
                      onShare={() => setShareTarget({ entry, rank: index + 1 })}
                      onToggle={() =>
                        setExpandedCreatorId((prev) =>
                          prev === entry.creatorId ? null : entry.creatorId
                        )
                      }
                    />
                    {expanded && details.length > 0 && (
                      <tr>
                        <td colSpan={10} style={{ padding: '10px 16px', background: 'rgba(2,6,23,0.6)' }}>
                          <div style={{ fontSize: 12, color: '#93c5fd', marginBottom: 8 }}>
                            评分明细（每条推文的关键贡献）
                          </div>
                          <div style={{ display: 'grid', gap: 8 }}>
                            {details.map((detail) => (
                              <div
                                key={detail.tweetId}
                                style={{
                                  border: '1px solid rgba(71,85,105,0.7)',
                                  borderRadius: 10,
                                  padding: '8px 10px',
                                  background: 'rgba(15,23,42,0.7)'
                                }}
                              >
                                <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 4 }}>
                                  {truncateText(detail.text, 180)}
                                </div>
                                <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
                                  ❤️ {detail.likes} · 👀 {detail.views} · 💬 {detail.replies} · 🔁{' '}
                                  {detail.retweets} · 🗨️ {detail.quotes} · rawEng{' '}
                                  {detail.rawEngagement.toFixed(2)} · normEng{' '}
                                  {detail.normalizedEngagement.toFixed(4)} · spam {detail.spamScore.toFixed(4)} ·
                                  diversity {detail.tokenDiversity.toFixed(4)}
                                </div>
                                <div style={{ fontSize: 11, color: '#a5b4fc', lineHeight: 1.6 }}>
                                  {detail.isRetweet ? 'RT' : '原创'} ·{' '}
                                  传播信号 reach:{detail.influenceSignals.reach.toFixed(4)} / conv:
                                  {detail.influenceSignals.conversation.toFixed(4)} / reshare:
                                  {detail.influenceSignals.reshare.toFixed(4)} / penetration:
                                  {detail.influenceSignals.penetration.toFixed(4)} · 深度信号:{' '}
                                  {detail.depthSignals.length > 0 ? detail.depthSignals.join(', ') : '无'}
                                </div>
                                {detail.mediaInsights.hasMedia && (
                                  <div style={{ marginTop: 6, fontSize: 11, color: '#7dd3fc', lineHeight: 1.6 }}>
                                    媒体识别: 共{detail.mediaInsights.mediaCount}个媒体（图{detail.mediaInsights.imageCount}/视频
                                    {detail.mediaInsights.videoCount}）
                                    {detail.mediaInsights.mediaTags.length > 0
                                      ? ` · 标签: ${detail.mediaInsights.mediaTags.join(', ')}`
                                      : ''}
                                    {` · 深度加权+${detail.mediaInsights.mediaDepthBoost.toFixed(3)} / 影响力加权+${detail.mediaInsights.mediaInfluenceBoost.toFixed(3)}`}
                                    {detail.mediaInsights.pnlBucket !== 'none'
                                      ? ` · PNL档位: ${formatPnlBucket(detail.mediaInsights.pnlBucket)} (${detail.mediaInsights.pnlUSD?.toFixed(2)} USD, 证据分${detail.mediaInsights.pnlEvidenceScore})`
                                      : ''}
                                    {detail.mediaInsights.altTextSummary
                                      ? ` · Alt: ${truncateText(detail.mediaInsights.altTextSummary, 120)}`
                                      : ''}
                                    {detail.mediaInsights.ocrSummary
                                      ? ` · OCR: ${truncateText(detail.mediaInsights.ocrSummary, 140)}`
                                      : ''}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {currentLeaderboard.entries.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    style={{
                      padding: '16px 20px',
                      textAlign: 'center',
                      color: '#6b7280'
                    }}
                  >
                    暂无数据。请添加推文和交易后查看排行榜。
                  </td>
                </tr>
              )}
            </tbody>
            </table>
          </div>
        </section>

        {shareTarget && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(2,6,23,0.75)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: 16
            }}
            onClick={() => setShareTarget(null)}
          >
            <div
              style={{
                width: 'min(92vw, 560px)',
                background: 'rgba(15,23,42,0.98)',
                border: '1px solid rgba(148,163,184,0.35)',
                borderRadius: 14,
                padding: 14
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8
                }}
              >
                <div style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 600 }}>
                  分享评分图：{shareTarget.entry.handle}
                </div>
                <button
                  type="button"
                  onClick={() => setShareTarget(null)}
                  style={{
                    border: '1px solid rgba(71,85,105,0.9)',
                    background: 'rgba(2,6,23,0.7)',
                    color: '#cbd5e1',
                    borderRadius: 8,
                    padding: '4px 8px',
                    cursor: 'pointer'
                  }}
                >
                  关闭
                </button>
              </div>

              <div
                style={{
                  borderRadius: 10,
                  overflow: 'hidden',
                  border: '1px solid rgba(51,65,85,0.9)',
                  background: '#020617',
                  marginBottom: 10
                }}
              >
                {shareImageUrl ? (
                  <img
                    src={shareImageUrl}
                    alt="share preview"
                    style={{ display: 'block', width: '100%', height: 'auto' }}
                  />
                ) : (
                  <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>生成中...</div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={handleDownloadShareImage}
                  style={{
                    flex: 1,
                    borderRadius: 10,
                    border: '1px solid rgba(59,130,246,0.8)',
                    padding: '8px 10px',
                    color: '#dbeafe',
                    background: 'linear-gradient(90deg, #1d4ed8, #2563eb)',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  下载图片
                </button>
                <button
                  type="button"
                  onClick={handleCopyShareImage}
                  style={{
                    flex: 1,
                    borderRadius: 10,
                    border: '1px solid rgba(71,85,105,0.8)',
                    padding: '8px 10px',
                    color: '#e2e8f0',
                    background: 'rgba(30,41,59,0.95)',
                    cursor: 'pointer',
                    fontWeight: 600
                  }}
                >
                  复制图片
                </button>
              </div>
              {shareHint && <div style={{ marginTop: 8, fontSize: 12, color: '#93c5fd' }}>{shareHint}</div>}
            </div>
          </div>
        )}
      </main>
    </>
  );
}

function parseTweetLinks(input: string): { valid: string[]; invalid: string[] } {
  const rawItems = input
    .split(/[\n,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const normalizedItems = rawItems.map((item) =>
    /^https?:\/\//i.test(item) ? item : `https://${item}`
  );

  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const item of normalizedItems) {
    if (seen.has(item)) continue;
    seen.add(item);

    const isValid = /^https?:\/\/(x\.com|twitter\.com)\/[^/\s]+\/status\/\d+(?:\?.*)?$/i.test(item);
    if (isValid) valid.push(item);
    else invalid.push(item);
  }

  return { valid, invalid };
}

interface RowProps {
  rank: number;
  entry: CreatorScoreBreakdown;
  detailCount: number;
  expanded: boolean;
  onToggle: () => void;
  onShare: () => void;
}

function LeaderboardRow({ rank, entry, detailCount, expanded, onToggle, onShare }: RowProps) {
  const isTop = rank === 1;
  const scoreColor = (score: number) => {
    if (score >= 80) return '#86efac';
    if (score >= 60) return '#facc15';
    if (score >= 40) return '#c4b5fd';
    return '#f472b6';
  };

  return (
    <tr
      style={{
        backgroundColor: rank % 2 === 0 ? 'rgba(15,23,42,0.9)' : 'rgba(15,23,42,0.7)'
      }}
    >
      <td
        style={{
          padding: '10px 16px',
          fontWeight: 700,
          color: isTop ? '#fbbf24' : '#e5e7eb'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{entry.handle}</span>
          {detailCount > 0 && (
            <button
              type="button"
              onClick={onToggle}
              style={{
                border: '1px solid rgba(71,85,105,0.8)',
                background: 'rgba(2,6,23,0.6)',
                color: '#93c5fd',
                borderRadius: 8,
                fontSize: 11,
                padding: '2px 6px',
                cursor: 'pointer'
              }}
            >
              {expanded ? '收起明细' : `明细(${detailCount})`}
            </button>
          )}
        </div>
      </td>
      <td style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums' }}>
        {entry.followers.toLocaleString('en-US')}
      </td>
      <td style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums' }}>
        {entry.tweetsCount}
      </td>
      <td
        style={{
          padding: '10px 16px',
          fontVariantNumeric: 'tabular-nums',
          color: scoreColor(entry.contentScore)
        }}
      >
        {entry.contentScore.toFixed(2)}
      </td>
      <td
        style={{
          padding: '10px 16px',
          fontVariantNumeric: 'tabular-nums',
          color: scoreColor(entry.derivativeScore)
        }}
      >
        {entry.derivativeScore.toFixed(2)}
      </td>
      <td
        style={{
          padding: '10px 16px',
          fontVariantNumeric: 'tabular-nums',
          color: scoreColor(entry.depthScore)
        }}
      >
        {entry.depthScore.toFixed(2)}
      </td>
      <td
        style={{
          padding: '10px 16px',
          fontVariantNumeric: 'tabular-nums',
          color: scoreColor(entry.engagementScore)
        }}
      >
        {entry.engagementScore.toFixed(2)}
      </td>
      <td
        style={{
          padding: '10px 16px',
          fontVariantNumeric: 'tabular-nums',
          color: scoreColor(entry.influenceScore)
        }}
      >
        {entry.influenceScore.toFixed(2)}
      </td>
      <td
        style={{
          padding: '10px 16px',
          fontVariantNumeric: 'tabular-nums',
          color: scoreColor(entry.activityScore)
        }}
      >
        {entry.activityScore.toFixed(2)}
      </td>
      <td
        style={{
          padding: '10px 16px',
          fontVariantNumeric: 'tabular-nums',
          color: isTop ? '#fbbf24' : '#fde68a',
          fontWeight: 700
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{entry.totalScore.toFixed(2)}</span>
          <button
            type="button"
            onClick={onShare}
            style={{
              border: '1px solid rgba(71,85,105,0.85)',
              background: 'rgba(2,6,23,0.65)',
              color: '#93c5fd',
              borderRadius: 8,
              fontSize: 11,
              padding: '2px 7px',
              cursor: 'pointer'
            }}
          >
            分享
          </button>
        </div>
      </td>
    </tr>
  );
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function formatPnlBucket(bucket: 'none' | 'lt100' | '100_500' | '500_1000' | 'gte1000'): string {
  if (bucket === 'lt100') return '<100 USD';
  if (bucket === '100_500') return '100~500 USD';
  if (bucket === '500_1000') return '500~1000 USD';
  if (bucket === 'gte1000') return '>1000 USD';
  return '无';
}

async function renderShareImage(entry: CreatorScoreBreakdown, rank: number): Promise<string> {
  const size = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const centerX = size / 2;
  const centerY = size / 2 + 110;
  const radius = 290;

  // background
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#0b1228');
  bg.addColorStop(1, '#020617');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 56px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Minara Score Card', centerX, 92);

  // subtle header separator and glow for cleaner premium style
  ctx.beginPath();
  ctx.moveTo(96, 122);
  ctx.lineTo(size - 96, 122);
  ctx.strokeStyle = 'rgba(148,163,184,0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const topGlow = ctx.createRadialGradient(centerX, 108, 20, centerX, 108, 260);
  topGlow.addColorStop(0, 'rgba(56,189,248,0.16)');
  topGlow.addColorStop(1, 'rgba(56,189,248,0)');
  ctx.fillStyle = topGlow;
  ctx.fillRect(0, 0, size, 220);

  const rankTag = getRankTag(rank);

  const labels = ['内容分', '衍生分', '深度', '互动', '影响力', '活跃度'];
  const values = [
    clampScore(entry.contentScore),
    clampScore(entry.derivativeScore),
    clampScore(entry.depthScore),
    clampScore(entry.engagementScore),
    clampScore(entry.influenceScore),
    clampScore(entry.activityScore)
  ];

  // grid hexagons
  for (let l = 1; l <= 5; l++) {
    const r = (radius / 5) * l;
    drawPolygon(ctx, centerX, centerY, r, 6, {
      stroke: 'rgba(148,163,184,0.22)',
      fill: 'transparent'
    });
  }
  // axis lines
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(x, y);
    ctx.strokeStyle = 'rgba(148,163,184,0.26)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // data polygon
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < values.length; i++) {
    const ratio = values[i] / 100;
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
    points.push({
      x: centerX + radius * ratio * Math.cos(angle),
      y: centerY + radius * ratio * Math.sin(angle)
    });
  }

  ctx.beginPath();
  points.forEach((point, idx) => {
    if (idx === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.shadowColor = 'rgba(56,189,248,0.35)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = 'rgba(56,189,248,0.24)';
  ctx.strokeStyle = 'rgba(56,189,248,0.9)';
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // labels
  ctx.font = '28px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillStyle = '#cbd5e1';
  for (let i = 0; i < labels.length; i++) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
    const x = centerX + (radius + 72) * Math.cos(angle);
    const y = centerY + (radius + 72) * Math.sin(angle);
    ctx.fillText(labels[i], x, y);
  }

  // left-bottom identity block under title
  const leftCardX = 108;
  const leftCardY = 118;
  const leftCardW = 468;
  const leftCardH = 138;
  ctx.beginPath();
  roundRectPath(ctx, leftCardX, leftCardY, leftCardW, leftCardH, 24);
  ctx.fillStyle = 'rgba(15,23,42,0.82)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(125,211,252,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const avatarRadius = 36;
  const avatarCenterX = leftCardX + 58;
  const avatarCenterY = leftCardY + leftCardH / 2;
  await drawAvatarOrFallback(ctx, entry, avatarCenterX, avatarCenterY, avatarRadius);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#bfdbfe';
  const handleFontSize = getShareHandleFontSize(entry.handle);
  ctx.font = `bold ${handleFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.fillText(entry.handle, leftCardX + 112, leftCardY + 80);
  ctx.textAlign = 'center';

  // right-bottom total score block under title
  const rightCardX = size - 108 - 360;
  const rightCardY = 118;
  const rightCardW = 360;
  const rightCardH = 138;
  ctx.beginPath();
  roundRectPath(ctx, rightCardX, rightCardY, rightCardW, rightCardH, 24);
  ctx.fillStyle = 'rgba(15,23,42,0.84)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(250,204,21,0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 30px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText('总分', rightCardX + 26, rightCardY + 54);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#facc15';
  ctx.font = 'bold 62px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(entry.totalScore.toFixed(2), rightCardX + rightCardW - 24, rightCardY + 104);
  ctx.textAlign = 'center';

  // rank stimulus label
  if (rankTag) {
    ctx.beginPath();
    roundRectPath(ctx, rightCardX + 26, rightCardY + rightCardH - 40, 190, 30, 15);
    ctx.fillStyle = 'rgba(56,189,248,0.2)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(56,189,248,0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#7dd3fc';
    ctx.font = 'bold 20px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(rankTag, rightCardX + 121, rightCardY + rightCardH - 18);
  }

  // footer
  ctx.fillStyle = '#64748b';
  ctx.font = '22px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(`关注者 ${entry.followers.toLocaleString('zh-CN')} · 推文 ${entry.tweetsCount}`, centerX, size - 56);

  return canvas.toDataURL('image/png');
}

function getRankTag(rank: number): string {
  if (rank <= 0) return '';
  if (rank <= 10) return `TOP ${rank}`;
  if (rank <= 50) return 'TOP 50';
  if (rank <= 100) return 'TOP 100';
  return '';
}

function getShareHandleFontSize(handle: string): number {
  const length = handle.length;
  if (length >= 20) return 24;
  if (length >= 16) return 27;
  return 32;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

async function drawAvatarOrFallback(
  ctx: CanvasRenderingContext2D,
  entry: CreatorScoreBreakdown,
  x: number,
  y: number,
  radius: number
) {
  const avatarUrl = entry.profileImageUrl;
  if (!avatarUrl) {
    drawFallbackAvatar(ctx, entry.handle, x, y, radius);
    return;
  }

  try {
    const img = await loadImageElement(avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(148,163,184,0.8)';
    ctx.lineWidth = 4;
    ctx.stroke();
  } catch {
    drawFallbackAvatar(ctx, entry.handle, x, y, radius);
  }
}

function drawFallbackAvatar(
  ctx: CanvasRenderingContext2D,
  handle: string,
  x: number,
  y: number,
  radius: number
) {
  const initial = handle.replace('@', '').charAt(0).toUpperCase() || 'U';
  const grad = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
  grad.addColorStop(0, '#1d4ed8');
  grad.addColorStop(1, '#0ea5e9');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#e2e8f0';
  ctx.font = 'bold 48px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(initial, x, y + 16);
}

async function loadImageElement(url: string): Promise<HTMLImageElement> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`avatar ${response.status}`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const img = new Image();
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = reject;
  });
  img.src = objectUrl;
  const result = await loaded;
  URL.revokeObjectURL(objectUrl);
  return result;
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  sides: number,
  styles: { stroke: string; fill: string }
) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / sides;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = styles.stroke;
  ctx.fillStyle = styles.fill;
  ctx.stroke();
  if (styles.fill !== 'transparent') ctx.fill();
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}
