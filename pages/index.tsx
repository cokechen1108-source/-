import { GetServerSideProps } from 'next';
import Head from 'next/head';

import { getLeaderboard } from '../lib/score/creatorScore';
import { CreatorScoreBreakdown, LeaderboardResponse } from '../types/leaderboard';

interface Props {
  leaderboard: LeaderboardResponse;
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
  return (
    <>
      <Head>
        <title>Creator Leaderboard Demo</title>
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
          Mixed Chinese / English tweets + trading performance demo.
        </p>

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
              Updated at {new Date(leaderboard.updatedAt).toLocaleString()}
            </span>
          </header>

          <table
            style={{
              width: '100%',
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
                  'Rank',
                  'Creator',
                  'Content Score',
                  'Derivative Score',
                  'Total Score',
                  'Tweets',
                  'Trades',
                  'Total PnL (USD)'
                ].map((label) => (
                  <th
                    key={label}
                    style={{
                      textAlign: 'left',
                      padding: '10px 16px',
                      fontSize: 12,
                      textTransform: 'uppercase',
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
              {leaderboard.entries.map((entry, index) => (
                <LeaderboardRow
                  key={entry.creatorId}
                  rank={index + 1}
                  entry={entry}
                />
              ))}
              {leaderboard.entries.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    style={{
                      padding: '16px 20px',
                      textAlign: 'center',
                      color: '#6b7280'
                    }}
                  >
                    No data yet. Add some tweets and trades to see the leaderboard.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}

interface RowProps {
  rank: number;
  entry: CreatorScoreBreakdown;
}

function LeaderboardRow({ rank, entry }: RowProps) {
  const isTop = rank === 1;

  return (
    <tr
      style={{
        backgroundColor: rank % 2 === 0 ? 'rgba(15,23,42,0.9)' : 'rgba(15,23,42,0.7)'
      }}
    >
      <td
        style={{
          padding: '10px 16px',
          fontWeight: 600,
          color: isTop ? '#fbbf24' : '#e5e7eb'
        }}
      >
        {rank}
      </td>
      <td
        style={{
          padding: '10px 16px'
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <span
            style={{
              fontWeight: 600
            }}
          >
            {entry.creatorName}
          </span>
          <span
            style={{
              fontSize: 12,
              color: '#9ca3af'
            }}
          >
            {entry.handle}
          </span>
        </div>
      </td>
      <td style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums' }}>
        {entry.contentScore.toFixed(2)}
      </td>
      <td style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums' }}>
        {entry.derivativeScore.toFixed(2)}
      </td>
      <td
        style={{
          padding: '10px 16px',
          fontVariantNumeric: 'tabular-nums',
          color: isTop ? '#fbbf24' : '#a5b4fc',
          fontWeight: 600
        }}
      >
        {entry.totalScore.toFixed(2)}
      </td>
      <td style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums' }}>
        {entry.tweetsCount}
      </td>
      <td style={{ padding: '10px 16px', fontVariantNumeric: 'tabular-nums' }}>
        {entry.tradesCount}
      </td>
      <td
        style={{
          padding: '10px 16px',
          fontVariantNumeric: 'tabular-nums',
          color: entry.totalPnlUSD >= 0 ? '#4ade80' : '#f97373'
        }}
      >
        {entry.totalPnlUSD.toFixed(2)}
      </td>
    </tr>
  );
}
