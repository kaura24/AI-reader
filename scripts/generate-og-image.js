import { createCanvas } from 'canvas';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create canvas
const width = 1200;
const height = 630;
const canvas = createCanvas(width, height);
const ctx = canvas.getContext('2d');

// Background gradient
const bgGrad = ctx.createLinearGradient(0, 0, width, height);
bgGrad.addColorStop(0, '#1e293b');
bgGrad.addColorStop(1, '#0f172a');
ctx.fillStyle = bgGrad;
ctx.fillRect(0, 0, width, height);

// Decorative circles
ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
ctx.beginPath();
ctx.arc(100, 100, 200, 0, Math.PI * 2);
ctx.fill();

ctx.fillStyle = 'rgba(139, 92, 246, 0.1)';
ctx.beginPath();
ctx.arc(1100, 530, 250, 0, Math.PI * 2);
ctx.fill();

// Document icon background
ctx.fillStyle = '#334155';
ctx.beginPath();
ctx.roundRect(500, 120, 200, 250, 20);
ctx.fill();

// Document icon border
const borderGrad = ctx.createLinearGradient(500, 120, 700, 120);
borderGrad.addColorStop(0, '#3b82f6');
borderGrad.addColorStop(1, '#8b5cf6');
ctx.strokeStyle = borderGrad;
ctx.lineWidth = 4;
ctx.stroke();

// Document lines
ctx.fillStyle = '#64748b';
ctx.beginPath();
ctx.roundRect(530, 160, 140, 12, 6);
ctx.fill();

ctx.beginPath();
ctx.roundRect(530, 190, 100, 12, 6);
ctx.fill();

ctx.beginPath();
ctx.roundRect(530, 220, 120, 12, 6);
ctx.fill();

// Magnifying glass
ctx.strokeStyle = borderGrad;
ctx.lineWidth = 8;
ctx.beginPath();
ctx.arc(670, 320, 50, 0, Math.PI * 2);
ctx.stroke();

// Magnifying glass handle
ctx.beginPath();
ctx.moveTo(705, 355);
ctx.lineTo(740, 390);
ctx.stroke();

// Check mark
ctx.strokeStyle = '#22c55e';
ctx.lineWidth = 6;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';
ctx.beginPath();
ctx.moveTo(645, 320);
ctx.lineTo(660, 335);
ctx.lineTo(695, 300);
ctx.stroke();

// Title
ctx.fillStyle = '#f8fafc';
ctx.font = 'bold 56px system-ui, -apple-system, sans-serif';
ctx.textAlign = 'center';
ctx.fillText('사업자등록번호 추출기', 600, 470);

// Subtitle
ctx.fillStyle = '#94a3b8';
ctx.font = '28px system-ui, -apple-system, sans-serif';
ctx.fillText('이미지에서 상품번호로 사업자번호 자동 조회', 600, 530);

// Bottom accent line
const accentGrad = ctx.createLinearGradient(400, 580, 800, 580);
accentGrad.addColorStop(0, '#3b82f6');
accentGrad.addColorStop(1, '#8b5cf6');
ctx.fillStyle = accentGrad;
ctx.beginPath();
ctx.roundRect(400, 580, 400, 6, 3);
ctx.fill();

// Save to file
const buffer = canvas.toBuffer('image/png');
const outputPath = join(__dirname, '..', 'static', 'og-image.png');
writeFileSync(outputPath, buffer);

console.log('✅ OG 이미지 생성 완료:', outputPath);

