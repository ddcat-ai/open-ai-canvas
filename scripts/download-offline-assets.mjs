import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 参数解析
const args = process.argv.slice(2);
const ASSETS_ROOT = path.resolve(rootDir, "web/public/offline-assets");
const MANIFESTS_DIR = path.resolve(ASSETS_ROOT, "manifests");
const VIDEO_PRESETS_FILE = path.resolve(rootDir, "web/public/data/video-presets.json");
const IMAGE_PRESETS_FILE = path.resolve(rootDir, "web/public/data/image-presets.json");

// 确保基础目录与分类目录存在
fs.mkdirSync(ASSETS_ROOT, { recursive: true });
fs.mkdirSync(MANIFESTS_DIR, { recursive: true });

const modelArg = args.find(a => a.startsWith('--model='))?.split('=')[1]?.toLowerCase() || 'all';
const typeArg = args.find(a => a.startsWith('--type='))?.split('=')[1]?.toLowerCase() || 'all'; // 'all' | 'video' | 'cover' | 'image'
const categoryArg = args.find(a => a.startsWith('--category='))?.split('=')[1] || 'all';
const diffOnly = args.includes('--diff-only') || args.includes('-d');
const concurrencyArg = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '6', 10);
const limitArg = args.find(a => a.startsWith('--limit=')) ? parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1], 10) : null;

console.log('====================================================');
console.log('     Open-AI-Canvas 离线资产增量与断点续传下载管理器     ');
console.log('====================================================');
console.log(`存储目标:   web/public/offline-assets (本地离线资产目录)`);
console.log(`存储根路径: ${ASSETS_ROOT}`);
console.log(`筛选配置:   model=${modelArg}, type=${typeArg}, category=${categoryArg}`);
console.log(`运行模式:   ${diffOnly ? '仅对比分析 (Diff Only)' : `执行下载 (并发数: ${concurrencyArg})`}\n`);

// 读取预设数据
const videoPresets = JSON.parse(fs.readFileSync(VIDEO_PRESETS_FILE, 'utf8'));
const imagePresets = JSON.parse(fs.readFileSync(IMAGE_PRESETS_FILE, 'utf8'));

// 规范化识别模型归属分类
function getModelCategory(preset) {
  if (preset.id && preset.id.startsWith('gpt-image-2-')) return 'gpt-image-2';

  const tags = preset.tags || [];
  if (tags.some(t => /seedance\s*2\.5/i.test(t))) return 'seedance-2-5';
  if (tags.some(t => /seedance\s*2\.0/i.test(t))) return 'seedance-2-0';
  if (tags.some(t => /omni|gemini/i.test(t))) return 'omni';
  if (tags.some(t => /grok/i.test(t))) return 'grok';
  if (tags.some(t => /h3|minimax/i.test(t))) return 'minimax-h3';

  // 根据 ID 前缀匹配
  if (preset.id.startsWith('youmind-seedance25-') || preset.id.startsWith('seedance-2-5-')) return 'seedance-2-5';
  if (preset.id.startsWith('youmind-seedance20-') || preset.id.startsWith('seedance-2-0-')) return 'seedance-2-0';
  if (preset.id.startsWith('youmind-omni-')) return 'omni';
  if (preset.id.startsWith('youmind-grok-')) return 'grok';
  if (preset.id.startsWith('minimax-h3-')) return 'minimax-h3';

  return 'other';
}

// 构建全量待下载任务索引清单
const allTasks = [];

// 1. 生图预设 (GPT Image 2 等)
for (const p of imagePresets) {
  const modelCat = getModelCategory(p);
  const remoteUrl = p.remoteBackupUrl || p.previewImage;
  if (remoteUrl && remoteUrl.startsWith('http')) {
    const ext = remoteUrl.includes('.webp') ? 'webp' : (remoteUrl.includes('.png') ? 'png' : 'jpg');
    const relPath = `${modelCat}/images/${p.id}.${ext}`;
    allTasks.push({
      id: p.id,
      presetId: p.id,
      title: p.title,
      modelCategory: modelCat,
      category: p.category,
      type: 'image',
      remoteUrl,
      relPath,
      destPath: path.resolve(ASSETS_ROOT, relPath),
      estimatedSizeBytes: 280 * 1024 // 约 280 KB
    });
  }
}

// 2. 生视频预设 (Seedance 2.5, Seedance 2.0, Omni, Grok, MiniMax H3)
for (const p of videoPresets) {
  const modelCat = getModelCategory(p);

  // 封面任务
  const remoteCover = p.remoteThumbBackupUrl || p.previewThumbnail || (p.previewImage && !p.previewImage.endsWith('.mp4') ? p.previewImage : null);
  if (remoteCover && remoteCover.startsWith('http')) {
    const ext = remoteCover.includes('.png') ? 'png' : (remoteCover.includes('.webp') ? 'webp' : 'jpg');
    const relCover = `${modelCat}/covers/${p.id}.${ext}`;
    allTasks.push({
      id: `${p.id}-cover`,
      presetId: p.id,
      title: p.title,
      modelCategory: modelCat,
      category: p.category,
      type: 'cover',
      remoteUrl: remoteCover,
      relPath: relCover,
      destPath: path.resolve(ASSETS_ROOT, relCover),
      estimatedSizeBytes: 110 * 1024 // 约 110 KB
    });
  }

  // 视频任务
  const remoteVideo = p.remoteBackupUrl || p.previewVideo || (p.previewImage?.endsWith('.mp4') ? p.previewImage : null);
  if (remoteVideo && remoteVideo.startsWith('http')) {
    const relVideo = `${modelCat}/videos/${p.id}.mp4`;
    const isUrgent = p.previewVideo?.startsWith('/offline-assets/');
    allTasks.push({
      id: `${p.id}-video`,
      presetId: p.id,
      title: p.title,
      modelCategory: modelCat,
      category: p.category,
      type: 'video',
      remoteUrl: remoteVideo,
      relPath: relVideo,
      destPath: path.resolve(ASSETS_ROOT, relVideo),
      estimatedSizeBytes: 5.5 * 1024 * 1024, // 均值约 5.5 MB
      isUrgent: !!isUrgent
    });
  }
}

const urgentOnlyArg = args.includes('--urgent-only');

// 筛选符合 CLI 参数的任务
let filteredTasks = allTasks.filter(t => {
  if (modelArg !== 'all' && t.modelCategory !== modelArg) return false;
  if (typeArg !== 'all') {
    if (typeArg === 'video' && t.type !== 'video') return false;
    if (typeArg === 'cover' && t.type !== 'cover') return false;
    if (typeArg === 'image' && t.type !== 'image') return false;
  }
  if (categoryArg !== 'all' && t.category !== categoryArg) return false;
  if (urgentOnlyArg && !t.isUrgent) return false;
  return true;
});

const isTaskPending = (t) => {
  if (fs.existsSync(t.destPath)) {
    try {
      if (fs.statSync(t.destPath).size > 1024) return false;
    } catch {}
  }
  return true;
};

// 优先下载缺失且紧急的资产（未下载 > 已下载，紧急 > 非紧急）
filteredTasks.sort((a, b) => {
  const pendingDiff = (isTaskPending(b) ? 1 : 0) - (isTaskPending(a) ? 1 : 0);
  if (pendingDiff !== 0) return pendingDiff;
  return (b.isUrgent ? 1 : 0) - (a.isUrgent ? 1 : 0);
});

// ==========================================
// 核心模块 1: 新增对比分析器 (Diff Comparator)
// ==========================================
function runDiffAnalysis(tasks) {
  const modelStats = {};
  const models = ['seedance-2-5', 'seedance-2-0', 'omni', 'grok', 'minimax-h3', 'gpt-image-2', 'other'];

  models.forEach(m => {
    modelStats[m] = {
      name: m,
      total: 0,
      complete: 0,
      resumable: 0,
      pending: 0,
      downloadedBytes: 0,
      pendingBytes: 0
    };
  });

  tasks.forEach(t => {
    const stat = modelStats[t.modelCategory] || modelStats['other'];
    stat.total++;

    const downloadingPath = `${t.destPath}.downloading`;

    if (fs.existsSync(t.destPath)) {
      const s = fs.statSync(t.destPath);
      if (s.size > 1024) {
        stat.complete++;
        stat.downloadedBytes += s.size;
        return;
      }
    }

    if (fs.existsSync(downloadingPath)) {
      const s = fs.statSync(downloadingPath);
      if (s.size > 0) {
        stat.resumable++;
        stat.pendingBytes += Math.max(0, t.estimatedSizeBytes - s.size);
        return;
      }
    }

    stat.pending++;
    stat.pendingBytes += t.estimatedSizeBytes;
  });

  console.log('┌─────────────────┬──────────┬──────────┬──────────┬────────────┬─────────────┐');
  console.log('│ 分类 / 模型库   │ 任务总数 │ 已完整落盘│ 待断点续传│ 新增待下载 │ 预计待下体积│');
  console.log('├─────────────────┼──────────┼──────────┼──────────┼────────────┼─────────────┤');

  let totalAll = 0, totalComp = 0, totalRes = 0, totalPend = 0, totalPendBytes = 0;

  for (const m of models) {
    const s = modelStats[m];
    if (s.total === 0) continue;

    totalAll += s.total;
    totalComp += s.complete;
    totalRes += s.resumable;
    totalPend += s.pending;
    totalPendBytes += s.pendingBytes;

    const mb = (s.pendingBytes / (1024 * 1024)).toFixed(1).padStart(7, ' ');
    console.log(
      `│ ${s.name.padEnd(15, ' ')} │ ` +
      `${String(s.total).padStart(8, ' ')} │ ` +
      `${String(s.complete).padStart(8, ' ')} │ ` +
      `${String(s.resumable).padStart(8, ' ')} │ ` +
      `${String(s.pending).padStart(10, ' ')} │ ` +
      `${mb} MB │`
    );
  }

  console.log('├─────────────────┼──────────┼──────────┼──────────┼────────────┼─────────────┤');
  const totalMb = (totalPendBytes / (1024 * 1024)).toFixed(1).padStart(7, ' ');
  console.log(
    `│ 全量汇总统计    │ ` +
    `${String(totalAll).padStart(8, ' ')} │ ` +
    `${String(totalComp).padStart(8, ' ')} │ ` +
    `${String(totalRes).padStart(8, ' ')} │ ` +
    `${String(totalPend).padStart(10, ' ')} │ ` +
    `${totalMb} MB │`
  );
  console.log('└─────────────────┴──────────┴──────────┴──────────┴────────────┴─────────────┘\n');

  return { totalAll, totalComp, totalRes, totalPend, totalPendBytes };
}

const diffResult = runDiffAnalysis(filteredTasks);

if (diffOnly) {
  buildCategorizedManifests(allTasks);
  console.log('⚡ 当前为 --diff-only 模式，对比分析与 Manifest 索引构建完成，退出执行。');
  process.exit(0);
}

if (diffResult.totalPend === 0 && diffResult.totalRes === 0) {
  console.log('🎉 当前筛选范围内的所有离线资产已 100% 完整下载就绪，无需重复下载！');
  process.exit(0);
}

// ==========================================
// 核心模块 2: 断点续传下载器 (Resumable Downloader)
// ==========================================
async function downloadFileResumable(task, retries = 3) {
  const { remoteUrl, destPath } = task;

  // 1. 已有完整文件直接跳过
  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    if (stat.size > 1024) {
      return { status: 'skipped', size: stat.size, resumed: false };
    }
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tempPath = `${destPath}.downloading`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    let existingBytes = 0;
    if (fs.existsSync(tempPath)) {
      existingBytes = fs.statSync(tempPath).size;
    }

    try {
      let fetchUrl = remoteUrl;
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)'
      };

      // 避免 Twitter 防盗链 403：Twitter 域名绝不传递非推特 Referer
      if (!remoteUrl.includes('twimg.com')) {
        headers['Referer'] = 'https://youmind.com/';
      } else if (remoteUrl.includes('pbs.twimg.com') && attempt > 1) {
        // 若推特图片直连重试失败，平滑降级走 YouMind Next.js 优化镜像
        fetchUrl = `https://youmind.com/_next/image?url=${encodeURIComponent(remoteUrl)}&w=1080&q=85`;
      }

      // 启用 Range 请求实现断点续传
      if (existingBytes > 0) {
        headers['Range'] = `bytes=${existingBytes}-`;
      }

      const response = await fetch(fetchUrl, { 
        headers,
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok && response.status !== 206) {
        // 如果服务器不支持 Range 请求 (416)，则重置从 0 字节开始
        if (response.status === 416) {
          try { fs.unlinkSync(tempPath); } catch {}
          existingBytes = 0;
          continue;
        }
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const isResumed = response.status === 206;
      const fileStream = fs.createWriteStream(tempPath, { flags: isResumed ? 'a' : 'w' });

      // Node.js 原生流式管道落盘
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(Buffer.from(value));
      }
      fileStream.end();

      await new Promise(resolve => fileStream.on('finish', resolve));

      // 原子重命名为正式文件
      fs.renameSync(tempPath, destPath);
      const finalStat = fs.statSync(destPath);
      return { status: 'downloaded', size: finalStat.size, resumed: isResumed };
    } catch (err) {
      if (attempt === retries) {
        return { status: 'failed', error: err.message };
      }
      await new Promise(r => setTimeout(r, attempt * 1500));
    }
  }
}

// 并发池队列执行器
async function runConcurrentQueue(taskList, concurrency, label) {
  let index = 0;
  let completed = 0;
  let downloadedCount = 0;
  let resumedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let downloadedBytes = 0;
  const startTime = Date.now();

  console.log(`\n[${label}] 开始下载队列，有效任务: ${taskList.length}，并发数: ${concurrency}`);

  let lastLogTime = Date.now();
  const updateProgress = (forceNewLine = false) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const mb = (downloadedBytes / (1024 * 1024)).toFixed(1);
    const line = `[${label}] 进度: ${completed}/${taskList.length} (${((completed / (taskList.length || 1)) * 100).toFixed(1)}%) | 下载: ${downloadedCount}, 续传: ${resumedCount}, 跳过: ${skippedCount}, 失败: ${failedCount} | 体积: ${mb} MB | 用时: ${elapsed}s`;
    
    if (forceNewLine || Date.now() - lastLogTime >= 8000) {
      console.log(line);
      lastLogTime = Date.now();
    } else {
      process.stdout.write(`\r${line}`);
    }
  };

  const timer = setInterval(() => updateProgress(false), 1000);

  const worker = async () => {
    while (index < taskList.length) {
      const currentTask = taskList[index++];
      const res = await downloadFileResumable(currentTask);
      completed++;

      if (res.status === 'downloaded') {
        downloadedCount++;
        if (res.resumed) resumedCount++;
        downloadedBytes += res.size;
      } else if (res.status === 'skipped') {
        skippedCount++;
      } else {
        failedCount++;
        if (failedCount <= 10) {
          console.error(`\n[失败] ${currentTask.id}: ${res.error} (URL: ${currentTask.remoteUrl})`);
        }
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  clearInterval(timer);
  updateProgress();
  console.log(`\n[${label}] 阶段完成！耗时: ${((Date.now() - startTime) / 1000).toFixed(1)}s\n`);

  return { completed, downloadedCount, resumedCount, skippedCount, failedCount, downloadedBytes };
}

// ==========================================
// 核心模块 3: 分类索引 Manifest 生成
// ==========================================
function buildCategorizedManifests(tasks) {
  console.log('正在构建分类资产索引 Manifest...');
  const overallManifest = {
    version: '1.0.0',
    updatedAt: new Date().toISOString(),
    totalAssets: 0,
    downloadedAssets: 0,
    totalSizeBytes: 0,
    models: {}
  };

  const modelManifests = {};

  tasks.forEach(t => {
    const model = t.modelCategory;
    if (!modelManifests[model]) {
      modelManifests[model] = {
        model,
        updatedAt: new Date().toISOString(),
        totalAssets: 0,
        downloadedAssets: 0,
        totalSizeBytes: 0,
        assets: {}
      };
    }

    const isDownloaded = fs.existsSync(t.destPath);
    let size = 0;
    if (isDownloaded) {
      size = fs.statSync(t.destPath).size;
      modelManifests[model].downloadedAssets++;
      modelManifests[model].totalSizeBytes += size;
      overallManifest.downloadedAssets++;
      overallManifest.totalSizeBytes += size;
    }

    modelManifests[model].totalAssets++;
    overallManifest.totalAssets++;

    modelManifests[model].assets[t.id] = {
      presetId: t.presetId,
      title: t.title,
      type: t.type,
      category: t.category,
      relPath: t.relPath,
      downloaded: isDownloaded,
      sizeBytes: size,
      remoteUrl: t.remoteUrl
    };
  });

  // 保存每个模型的专属 Manifest
  for (const [model, mData] of Object.entries(modelManifests)) {
    const mPath = path.resolve(MANIFESTS_DIR, `${model}.json`);
    fs.writeFileSync(mPath, JSON.stringify(mData, null, 2));
    overallManifest.models[model] = {
      total: mData.totalAssets,
      downloaded: mData.downloadedAssets,
      sizeBytes: mData.totalSizeBytes,
      manifestPath: `manifests/${model}.json`
    };
  }

  // 保存总 Manifest
  const overallPath = path.resolve(MANIFESTS_DIR, 'manifest.json');
  fs.writeFileSync(overallPath, JSON.stringify(overallManifest, null, 2));
  console.log(`全量与分类 Manifest 索引已成功写入 ${MANIFESTS_DIR}`);
}

// 执行主下载流程
async function main() {
  // 分批次执行：优先下载图片封面（轻量快照），再下载流媒体视频原件
  let coversAndImages = filteredTasks.filter(t => t.type === 'cover' || t.type === 'image');
  let videos = filteredTasks.filter(t => t.type === 'video');

  if (limitArg && limitArg > 0) {
    coversAndImages = coversAndImages.slice(0, limitArg);
    videos = videos.slice(0, limitArg);
  }

  if (coversAndImages.length > 0 && (typeArg === 'all' || typeArg === 'cover' || typeArg === 'image')) {
    await runConcurrentQueue(coversAndImages, Math.min(concurrencyArg * 2, 16), '阶段 1: 封面海报与高保真大图');
  }

  if (videos.length > 0 && (typeArg === 'all' || typeArg === 'video')) {
    await runConcurrentQueue(videos, concurrencyArg, '阶段 2: 高清视频流媒体原件');
  }

  // 生成分类清单索引
  buildCategorizedManifests(allTasks);

  // 自动将已下载完成的本地离线文件路径同步回写至预设库
  updatePresetsWithLocalPaths();

  console.log('=== 全部处理完成！离线资产库与分类清单就绪 ===');
}

function updatePresetsWithLocalPaths() {
  console.log('正在将已下载的本地离线路径同步回写至预设库...');
  let updatedVideoCount = 0;
  let updatedCoverCount = 0;

  for (const p of videoPresets) {
    const modelCat = getModelCategory(p);
    // 检查本地视频是否存在
    const localVideoRel = `${modelCat}/videos/${p.id}.mp4`;
    const localVideoAbs = path.resolve(ASSETS_ROOT, localVideoRel);
    if (fs.existsSync(localVideoAbs) && fs.statSync(localVideoAbs).size > 1024) {
      const targetLocalUrl = `/offline-assets/${localVideoRel}`;
      if (p.previewVideo !== targetLocalUrl) {
        if (!p.remoteBackupUrl && p.previewVideo && p.previewVideo.startsWith('http')) {
          p.remoteBackupUrl = p.previewVideo;
        }
        p.previewVideo = targetLocalUrl;
        updatedVideoCount++;
      }
    }

    // 检查本地封面是否存在
    const exts = ['webp', 'jpg', 'png'];
    for (const ext of exts) {
      const localCoverRel = `${modelCat}/covers/${p.id}.${ext}`;
      const localCoverAbs = path.resolve(ASSETS_ROOT, localCoverRel);
      if (fs.existsSync(localCoverAbs) && fs.statSync(localCoverAbs).size > 1024) {
        const targetLocalCover = `/offline-assets/${localCoverRel}`;
        if (p.previewThumbnail !== targetLocalCover) {
          if (!p.remoteThumbBackupUrl && p.previewThumbnail && p.previewThumbnail.startsWith('http')) {
            p.remoteThumbBackupUrl = p.previewThumbnail;
          }
          p.previewThumbnail = targetLocalCover;
          if (!p.previewImage || p.previewImage.startsWith('http')) {
            p.previewImage = targetLocalCover;
          }
          updatedCoverCount++;
        }
        break;
      }
    }
  }

  fs.writeFileSync(VIDEO_PRESETS_FILE, JSON.stringify(videoPresets, null, 2), 'utf8');
  console.log(`video-presets.json 已同步更新: 新挂载 ${updatedVideoCount} 个本地视频, ${updatedCoverCount} 个本地封面！`);
}

main().catch(err => {
  console.error('下载任务发生异常:', err);
  process.exit(1);
});
