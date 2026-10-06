/**
 * TikTok Downloader (tanpa watermark) - Node.js + axios
 *
 * Install : npm i axios
 * Pakai   : node tiktok-dl.js <url_tiktok> [video|audio] [folder_output]
 * Contoh  : node tiktok-dl.js https://vt.tiktok.com/xxxx/ video ./downloads
 *
 * Sebagai modul:
 *   const { tiktokDl } = require('./tiktok-dl');
 *   const result = await tiktokDl('https://www.tiktok.com/@user/video/123');
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.tikwm.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const client = axios.create({
  baseURL: BASE,
  timeout: 30000,
  headers: {
    'User-Agent': UA,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Accept: 'application/json, text/javascript, */*; q=0.01',
    Origin: BASE,
    Referer: `${BASE}/`,
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abs = (u) => (!u ? null : /^https?:\/\//i.test(u) ? u : BASE + u);

/**
 * Ambil metadata + link download dari URL TikTok.
 * Mendukung video biasa dan slideshow (foto).
 */
async function tiktokDl(url, retries = 3) {
  if (!/tiktok\.com/i.test(url)) throw new Error('URL bukan link TikTok yang valid');

  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const body = new URLSearchParams({ url, count: '12', cursor: '0', web: '1', hd: '1' });
      const { data } = await client.post('/api/', body.toString());

      if (data.code !== 0 || !data.data) {
        throw new Error(data.msg || 'Gagal mengambil data video');
      }

      const d = data.data;
      return {
        id: d.id,
        title: d.title,
        duration: d.duration,
        cover: abs(d.cover),
        isSlideshow: Array.isArray(d.images) && d.images.length > 0,
        video: {
          noWatermark: abs(d.play),
          hd: abs(d.hdplay),
          watermark: abs(d.wmplay),
          size: d.size,
        },
        images: (d.images || []).map(abs),
        music: {
          title: d.music_info?.title || d.music_info?.original,
          author: d.music_info?.author,
          url: abs(d.music || d.music_info?.play),
        },
        author: {
          id: d.author?.id,
          username: d.author?.unique_id,
          nickname: d.author?.nickname,
          avatar: abs(d.author?.avatar),
        },
        stats: {
          plays: d.play_count,
          likes: d.digg_count,
          comments: d.comment_count,
          shares: d.share_count,
        },
      };
    } catch (err) {
      lastErr = err;
      // kena rate limit (1 req/detik) atau error sementara -> coba lagi
      if (i < retries) await sleep(1500 * (i + 1));
    }
  }
  throw new Error(`tiktokDl gagal: ${lastErr?.message || lastErr}`);
}

/** Download file dari URL langsung ke disk (streaming). */
async function downloadFile(fileUrl, filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const res = await axios.get(fileUrl, {
    responseType: 'stream',
    timeout: 60000,
    headers: { 'User-Agent': UA, Referer: `${BASE}/` },
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(filePath);
    res.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    res.data.on('error', reject);
  });

  return filePath;
}

/* ------------------------------ CLI ------------------------------ */
async function main() {
  const [url, mode = 'video', outDir = './downloads'] = process.argv.slice(2);

  if (!url) {
    console.log('Pemakaian: node tiktok-dl.js <url_tiktok> [video|audio] [folder_output]');
    process.exit(1);
  }

  console.log('Mengambil data...');
  const r = await tiktokDl(url);
  console.log(`@${r.author.username} - ${r.title || '(tanpa judul)'}`);

  const base = `${r.author.username || 'tiktok'}_${r.id}`;

  if (mode === 'audio') {
    if (!r.music.url) throw new Error('Link audio tidak tersedia');
    const f = await downloadFile(r.music.url, path.join(outDir, `${base}.mp3`));
    return console.log('Audio tersimpan:', f);
  }

  if (r.isSlideshow) {
    for (let i = 0; i < r.images.length; i++) {
      const f = await downloadFile(r.images[i], path.join(outDir, `${base}_${i + 1}.jpg`));
      console.log('Foto tersimpan:', f);
    }
    return;
  }

  const videoUrl = r.video.hd || r.video.noWatermark || r.video.watermark;
  if (!videoUrl) throw new Error('Link video tidak tersedia');
  const f = await downloadFile(videoUrl, path.join(outDir, `${base}.mp4`));
  console.log('Video tersimpan:', f);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}

module.exports = { tiktokDl, downloadFile };
