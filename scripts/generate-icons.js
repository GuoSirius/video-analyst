import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ICONS_DIR = path.join(__dirname, '..', 'resources', 'icons');
const SVG_SOURCE = path.join(ICONS_DIR, 'icon-source.svg');

// 需要生成的图标尺寸
const SIZES = [16, 32, 64, 128, 256, 512, 1024];

// PNG 图标生成
async function generatePNGIcons() {
  console.log('正在生成 PNG 图标...');
  
  for (const size of SIZES) {
    await sharp(SVG_SOURCE)
      .resize(size, size)
      .png()
      .toFile(path.join(ICONS_DIR, `icon-${size}x${size}.png`));
    console.log(`  ✓ ${size}x${size}.png`);
  }
  
  // 生成主图标 (512x512)
  await sharp(SVG_SOURCE)
    .resize(512, 512)
    .png()
    .toFile(path.join(ICONS_DIR, 'icon.png'));
  console.log('  ✓ icon.png (512x512)');
}

// 托盘图标生成（简化版）
async function generateTrayIcons() {
  console.log('正在生成托盘图标...');
  
  // 标准托盘图标 (16x16)
  await sharp(SVG_SOURCE)
    .resize(16, 16)
    .png()
    .toFile(path.join(ICONS_DIR, 'tray.png'));
  console.log('  ✓ tray.png (16x16)');
  
  console.log('  提示：如需亮色/暗色模式托盘图标，请手动创建');
}

// 生成 Windows ICO 文件（需要多尺寸）
async function generateICO() {
  console.log('正在生成 Windows ICO 图标...');
  
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const inputs = await Promise.all(
    icoSizes.map(size => 
      sharp(SVG_SOURCE)
        .resize(size, size)
        .png()
        .toBuffer()
    )
  );
  
  // 使用 sharp 的 toFile 方法生成 ICO
  // 注意：sharp 不直接支持 ICO，需要使用其他工具或手动转换
  console.log('  注意：ICO 文件需要使用 electron-builder 或在线工具生成');
  console.log('  建议：使用生成的 PNG 图标，electron-builder 会自动处理');
}

async function main() {
  try {
    // 确保目录存在
    if (!fs.existsSync(ICONS_DIR)) {
      fs.mkdirSync(ICONS_DIR, { recursive: true });
    }
    
    await generatePNGIcons();
    await generateTrayIcons();
    await generateICO();
    
    console.log('\n✅ 图标生成完成！');
    console.log(`图标文件位置: ${ICONS_DIR}`);
    console.log('\n下一步：');
    console.log('1. 检查生成的图标效果');
    console.log('2. 更新 electron.vite.config.ts 配置');
    console.log('3. 使用 electron-builder 打包时会自动使用这些图标');
    
  } catch (error) {
    console.error('❌ 生成图标失败:', error);
    process.exit(1);
  }
}

main();
