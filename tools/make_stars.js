#!/usr/bin/env node
// stars.json 生成スクリプト
//
// HYG Database (https://www.astronexus.com/projects/hyg, CC BY-SA 4.0) の CSV から、
// 肉眼で見える等級 (V <= 6.5) の恒星を抽出して stars.json を生成する。
//
// 使い方:
//   1. HYG の CSV を取得（例: v4.1）
//      https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv
//   2. node tools/make_stars.js <CSVパス>
//      → リポジトリ直下に stars.json を出力
//
// 出力形式（コンパクトな配列の配列。座標変換や明るさの解釈はアプリ側で行う）:
//   { source, license, count, stars: [[raRad, decRad, mag, rgb24, pmraMas, pmdecMas], ...] }
//   - raRad/decRad : J2000 赤道座標 [rad]
//   - mag          : 視等級
//   - rgb24        : 色指数 B-V から黒体近似で求めた色 (0xRRGGBB)
//   - pmraMas/pmdecMas : 固有運動 [mas/年]（pmra は赤緯余弦込みの大円レート）

const fs = require('fs');
const path = require('path');

const MAG_LIMIT = 6.5;          // 肉眼の限界等級
const MAS_PER_RAD = 1 / 4.84813681109536e-9;

// ---- B-V 色指数 → RGB ----
// 色温度: Ballesteros (2012) の近似式
function bvToTemp(bv){
  return 4600 * (1/(0.92*bv + 1.7) + 1/(0.92*bv + 0.62));
}
// 黒体温度 → RGB: Tanner Helland のフィットを簡略化したもの（表示用の近似で十分）
function tempToRgb(t){
  t = Math.min(40000, Math.max(1000, t)) / 100;
  let r, g, b;
  if(t <= 66){
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  } else {
    r = 329.70 * Math.pow(t - 60, -0.1332);
    g = 288.12 * Math.pow(t - 60, -0.0755);
    b = 255;
  }
  const c = v => Math.min(255, Math.max(0, Math.round(v)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

// ---- 引用符対応の簡易CSVパーサ（1行分） ----
function parseCsvLine(line){
  const out = [];
  let cur = '', inQ = false;
  for(let i = 0; i < line.length; i++){
    const ch = line[i];
    if(inQ){
      if(ch === '"'){
        if(line[i+1] === '"'){ cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if(ch === '"') inQ = true;
    else if(ch === ','){ out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ---- メイン ----
const csvPath = process.argv[2];
if(!csvPath){
  console.error('使い方: node tools/make_stars.js <HYGのCSVパス>');
  process.exit(1);
}
const lines = fs.readFileSync(csvPath, 'utf8').split('\n');
const header = parseCsvLine(lines[0].trim());
const col = {};
header.forEach((name, i) => col[name] = i);
for(const need of ['id','mag','ci','rarad','decrad','pmrarad','pmdecrad'])
  if(!(need in col)) { console.error(`CSVに列 ${need} がありません`); process.exit(1); }

const stars = [];
for(let i = 1; i < lines.length; i++){
  const line = lines[i].trim();
  if(!line) continue;
  const f = parseCsvLine(line);
  if(f[col.id] === '0') continue;            // 太陽は除外（アプリ側で別途描画）
  const mag = parseFloat(f[col.mag]);
  if(!Number.isFinite(mag) || mag > MAG_LIMIT) continue;
  const ra = parseFloat(f[col.rarad]);
  const dec = parseFloat(f[col.decrad]);
  if(!Number.isFinite(ra) || !Number.isFinite(dec)) continue;
  const ci = parseFloat(f[col.ci]);
  const rgb = tempToRgb(bvToTemp(Number.isFinite(ci) ? ci : 0.5));
  const pmra = parseFloat(f[col.pmrarad]) || 0;
  const pmdec = parseFloat(f[col.pmdecrad]) || 0;
  stars.push([
    +ra.toFixed(5),                          // ~2"の精度で十分
    +dec.toFixed(5),
    +mag.toFixed(2),
    rgb,
    Math.round(pmra * MAS_PER_RAD),
    Math.round(pmdec * MAS_PER_RAD),
  ]);
}
stars.sort((a, b) => a[2] - b[2]);           // 明るい順（先頭を見れば妥当性確認しやすい）

const out = {
  source: `HYG Database (${path.basename(csvPath)}), https://www.astronexus.com/projects/hyg`,
  license: 'CC BY-SA 4.0',
  note: `V<=${MAG_LIMIT} の恒星。[raRad, decRad, mag, rgb24, pmraMas/yr, pmdecMas/yr]`,
  count: stars.length,
  stars,
};
const outPath = path.join(__dirname, '..', 'stars.json');
fs.writeFileSync(outPath, JSON.stringify(out).replace(/\],\[/g, '],\n['));
console.log(`${outPath}: ${stars.length} 星, ${(fs.statSync(outPath).size/1024).toFixed(0)} KB`);
