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

function fetchSvg(url, destPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (!data.includes('<svg') || data.length < 500) {
            return reject(new Error(`Invalid SVG payload received for ${url}`));
          }
          fs.writeFileSync(destPath, data, 'utf-8');
          console.log(`✓ Updated ${path.basename(destPath)} (${data.length} bytes)`);
          resolve();
        });
      })
      .on('error', reject);
  });
}

async function main() {
  const cards = [
    {
      url: 'https://github-readme-stats.vercel.app/api?username=petersisay&show_icons=true&bg_color=0D1117&title_color=38BDF8&text_color=E2E8F0&icon_color=38BDF8&border_color=30363D&count_private=true&custom_title=Petros%27s%20GitHub%20Stats',
      file: path.join(assetsDir, 'github-stats.svg'),
    },
    {
      url: 'https://github-readme-stats.vercel.app/api/top-langs/?username=petersisay&layout=compact&bg_color=0D1117&title_color=38BDF8&text_color=E2E8F0&border_color=30363D&hide=html,css,python&langs_count=6',
      file: path.join(assetsDir, 'top-langs.svg'),
    },
    {
      url: 'https://github-readme-streak-stats.herokuapp.com/?user=petersisay&theme=dark&background=0D1117&border=30363D&stroke=38BDF8&ring=38BDF8&fire=F59E0B&currStreakNum=FFFFFF&sideNums=FFFFFF&currStreakLabel=38BDF8&sideLabels=94A3B8&dates=94A3B8&timezone=Africa%2FAddis_Ababa',
      file: path.join(assetsDir, 'streak-stats.svg'),
    },
  ];

  for (const card of cards) {
    try {
      await fetchSvg(card.url, card.file);
    } catch (err) {
      console.warn(`Warning: Could not refresh ${path.basename(card.file)}: ${err.message}. Keeping existing version.`);
    }
  }
}

main();
