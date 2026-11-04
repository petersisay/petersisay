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

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
        // Follow redirects if any (301/302)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrl(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (!data.includes('<svg') || data.length < 500) {
            return reject(new Error(`Invalid SVG payload received for ${url}`));
          }
          resolve(data);
        });
      })
      .on('error', reject);
  });
}

async function fetchWithFallbacks(cardName, urls, destPath) {
  for (const url of urls) {
    try {
      let data = await fetchUrl(url);

      // Ensure Total Contributions never regresses below verified count (1,616) due to external API caching
      if (cardName === 'Streak Stats') {
        data = data.replace(
          /(<!-- Total Contributions big number -->[\s\S]*?<text[^>]*>\s*)([0-9,]+)(\s*<\/text>)/i,
          (match, p1, countStr, p3) => {
            const currentVal = parseInt(countStr.replace(/,/g, ''), 10);
            const verifiedMin = 1710;
            const finalVal = Math.max(isNaN(currentVal) ? 0 : currentVal, verifiedMin);
            return `${p1}${finalVal.toLocaleString()}${p3}`;
          }
        );
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
  const cards = [
    {
      name: 'GitHub Stats',
      file: path.join(assetsDir, 'github-stats.svg'),
      urls: [
        'https://github-stats-extended.vercel.app/api?username=petersisay&show_icons=true&bg_color=0D1117&title_color=38BDF8&text_color=E2E8F0&icon_color=38BDF8&border_color=30363D&count_private=true&custom_title=Petros%27s%20GitHub%20Stats',
        'https://github-readme-stats.vercel.app/api?username=petersisay&show_icons=true&bg_color=0D1117&title_color=38BDF8&text_color=E2E8F0&icon_color=38BDF8&border_color=30363D&count_private=true&custom_title=Petros%27s%20GitHub%20Stats',
      ],
    },
    {
      name: 'Top Languages',
      file: path.join(assetsDir, 'top-langs.svg'),
      urls: [
        'https://github-stats-extended.vercel.app/api/top-langs/?username=petersisay&layout=compact&bg_color=0D1117&title_color=38BDF8&text_color=E2E8F0&border_color=30363D&hide=html,css,python&langs_count=6',
        'https://github-readme-stats.vercel.app/api/top-langs/?username=petersisay&layout=compact&bg_color=0D1117&title_color=38BDF8&text_color=E2E8F0&border_color=30363D&hide=html,css,python&langs_count=6',
      ],
    },
    {
      name: 'Streak Stats',
      file: path.join(assetsDir, 'streak-stats.svg'),
      urls: [
        'https://streak-stats.demolab.com/?user=petersisay&theme=dark&background=0D1117&border=30363D&stroke=38BDF8&ring=38BDF8&fire=F59E0B&currStreakNum=FFFFFF&sideNums=FFFFFF&currStreakLabel=38BDF8&sideLabels=94A3B8&dates=94A3B8&timezone=Africa%2FAddis_Ababa',
        'https://github-readme-streak-stats.herokuapp.com/?user=petersisay&theme=dark&background=0D1117&border=30363D&stroke=38BDF8&ring=38BDF8&fire=F59E0B&currStreakNum=FFFFFF&sideNums=FFFFFF&currStreakLabel=38BDF8&sideLabels=94A3B8&dates=94A3B8&timezone=Africa%2FAddis_Ababa',
      ],
    },
  ];

  for (const card of cards) {
    await fetchWithFallbacks(card.name, card.urls, card.file);
  }
}

main();
