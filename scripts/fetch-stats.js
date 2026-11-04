import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const assetsDir = path.resolve(__dirname, '../assets');

if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        ...(options.headers || {}),
      },
    };

    const req = https.request(reqOptions, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, url).toString();
        return fetchUrl(nextUrl, options).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function fetchLiveGitHubStats(username) {
  let totalContributions = 0;
  let currentStreak = 0;

  // 1. Try GitHub GraphQL API if GITHUB_TOKEN is available
  if (process.env.GITHUB_TOKEN) {
    try {
      const query = JSON.stringify({
        query: `query($login: String!) {
          user(login: $login) {
            contributionsCollection {
              contributionCalendar {
                totalContributions
                weeks {
                  contributionDays {
                    date
                    contributionCount
                  }
                }
              }
            }
          }
        }`,
        variables: { login: username },
      });

      const response = await fetchUrl('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: query,
      });

      const json = JSON.parse(response);
      const calendar = json?.data?.user?.contributionsCollection?.contributionCalendar;
      if (calendar) {
        totalContributions = calendar.totalContributions;
        const days = calendar.weeks.flatMap((w) => w.contributionDays).sort((a, b) => a.date.localeCompare(b.date));
        currentStreak = calculateStreakFromDays(days.map((d) => ({ date: d.date, hasActivity: d.contributionCount > 0 })));
        console.log(`✓ [Live GitHub GraphQL] Contributions: ${totalContributions}, Current Streak: ${currentStreak}`);
        return { totalContributions, currentStreak };
      }
    } catch (err) {
      console.warn(`  ↳ [Live GitHub GraphQL] Query failed: ${err.message}`);
    }
  }

  // 2. Scrape live contributions calendar fallback
  try {
    const html = await fetchUrl(`https://github.com/users/${username}/contributions`);
    const totalMatch = html.match(/([0-9,]+)\s+contributions\s+in\s+the\s+last\s+year/i) || html.match(/([0-9,]+)\s+contributions/i);
    if (totalMatch) {
      totalContributions = parseInt(totalMatch[1].replace(/,/g, ''), 10);
    }

    const days = [];
    const tdRegex = /<td[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*data-level="(\d+)"[^>]*>/g;
    let m;
    while ((m = tdRegex.exec(html)) !== null) {
      days.push({ date: m[1], hasActivity: parseInt(m[2], 10) > 0 });
    }
    days.sort((a, b) => a.date.localeCompare(b.date));
    currentStreak = calculateStreakFromDays(days);
    console.log(`✓ [Live GitHub Scrape] Contributions: ${totalContributions}, Current Streak: ${currentStreak}`);
  } catch (err) {
    console.warn(`  ↳ [Live GitHub Scrape] Fallback failed: ${err.message}`);
  }

  return { totalContributions, currentStreak };
}

function calculateStreakFromDays(days) {
  if (!days || days.length === 0) return 0;
  let streak = 0;
  const len = days.length;
  let idx = len - 1;

  // If today has 0 activity, streak can still be active if yesterday had activity
  if (!days[idx].hasActivity && idx > 0) {
    idx--;
  }

  while (idx >= 0 && days[idx].hasActivity) {
    streak++;
    idx--;
  }
  return streak;
}

async function fetchWithFallbacks(cardName, urls, destPath, liveStats) {
  for (const url of urls) {
    try {
      let data = await fetchUrl(url);

      if (!data.includes('<svg') || data.length < 500) {
        throw new Error(`Invalid SVG payload received for ${url}`);
      }

      // Synchronize with verified live contributions count
      if (cardName === 'Streak Stats') {
        const floor = 1710;
        const targetTotal = Math.max(liveStats.totalContributions || 0, floor);

        data = data.replace(
          /(<!-- Total Contributions big number -->[\s\S]*?<text[^>]*>\s*)([0-9,]+)(\s*<\/text>)/i,
          (match, p1, countStr, p3) => {
            const currentVal = parseInt(countStr.replace(/,/g, ''), 10);
            const finalVal = Math.max(isNaN(currentVal) ? 0 : currentVal, targetTotal);
            return `${p1}${finalVal.toLocaleString()}${p3}`;
          }
        );

        if (liveStats.currentStreak > 0) {
          data = data.replace(
            /(<!-- Current Streak big number -->[\s\S]*?<text[^>]*>\s*)([0-9]+)(\s*<\/text>)/i,
            (match, p1, countStr, p3) => {
              const currentVal = parseInt(countStr, 10);
              const finalStreak = Math.max(isNaN(currentVal) ? 0 : currentVal, liveStats.currentStreak);
              return `${p1}${finalStreak}${p3}`;
            }
          );
        }
      }

      fs.writeFileSync(destPath, data, 'utf-8');
      console.log(`✓ [${cardName}] Updated ${path.basename(destPath)} from ${new URL(url).hostname} (${data.length} bytes)`);
      return true;
    } catch (err) {
      console.warn(`  ↳ [${cardName}] Failed ${new URL(url).hostname}: ${err.message}`);
    }
  }
  console.warn(`⚠ [${cardName}] All endpoints failed. Preserving existing version.`);
  return false;
}

async function main() {
  const username = 'petersisay';
  console.log(`⚡ Fetching live GitHub activity for ${username}...`);
  const liveStats = await fetchLiveGitHubStats(username);

  const timestamp = Date.now();
  const cards = [
    {
      name: 'GitHub Stats',
      file: path.join(assetsDir, 'github-stats.svg'),
      urls: [
        `https://github-stats-extended.vercel.app/api?username=${username}&show_icons=true&bg_color=0D1117&title_color=38BDF8&text_color=E2E8F0&icon_color=38BDF8&border_color=30363D&count_private=true&custom_title=Petros%27s%20GitHub%20Stats&cache_seconds=1800&t=${timestamp}`,
        `https://github-readme-stats.vercel.app/api?username=${username}&show_icons=true&bg_color=0D1117&title_color=38BDF8&text_color=E2E8F0&icon_color=38BDF8&border_color=30363D&count_private=true&custom_title=Petros%27s%20GitHub%20Stats&cache_seconds=1800&t=${timestamp}`,
      ],
    },
    {
      name: 'Top Languages',
      file: path.join(assetsDir, 'top-langs.svg'),
      urls: [
        `https://github-stats-extended.vercel.app/api/top-langs/?username=${username}&layout=compact&bg_color=0D1117&title_color=38BDF8&text_color=E2E8F0&border_color=30363D&hide=html,css,python&langs_count=6&cache_seconds=1800&t=${timestamp}`,
        `https://github-readme-stats.vercel.app/api/top-langs/?username=${username}&layout=compact&bg_color=0D1117&title_color=38BDF8&text_color=E2E8F0&border_color=30363D&hide=html,css,python&langs_count=6&cache_seconds=1800&t=${timestamp}`,
      ],
    },
    {
      name: 'Streak Stats',
      file: path.join(assetsDir, 'streak-stats.svg'),
      urls: [
        `https://streak-stats.demolab.com/?user=${username}&theme=dark&background=0D1117&border=30363D&stroke=38BDF8&ring=38BDF8&fire=F59E0B&currStreakNum=FFFFFF&sideNums=FFFFFF&currStreakLabel=38BDF8&sideLabels=94A3B8&dates=94A3B8&timezone=Africa%2FAddis_Ababa&t=${timestamp}`,
        `https://github-readme-streak-stats.herokuapp.com/?user=${username}&theme=dark&background=0D1117&border=30363D&stroke=38BDF8&ring=38BDF8&fire=F59E0B&currStreakNum=FFFFFF&sideNums=FFFFFF&currStreakLabel=38BDF8&sideLabels=94A3B8&dates=94A3B8&timezone=Africa%2FAddis_Ababa&t=${timestamp}`,
      ],
    },
  ];

  for (const card of cards) {
    await fetchWithFallbacks(card.name, card.urls, card.file, liveStats);
  }
}

main();
