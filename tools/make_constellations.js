#!/usr/bin/env node
// constellations.json 生成スクリプト
//
// 星座線: d3-celestial (Olaf Frohn, BSD-3-Clause) の constellations.lines.json を変換。
//         原典は IAU 星座図 (https://www.iau.org/public/constellations/, CC BY 4.0)。
//   https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json
// 星座の和名: 下の COMMON_NAMES（88星座の名称一覧。事実の列挙のため権利表記不要）。
// アステリズム: 下の ASTERISMS（HIP番号の自前リスト）。座標は HYG の CSV から引く。
//
// 使い方:
//   node tools/make_constellations.js <constellations.lines.jsonパス> <HYGのCSVパス>
//   → リポジトリ直下に constellations.json を出力
//
// 出力形式（角度はすべて J2000 赤道座標 [rad]。シーン系への変換はアプリ側で行う）:
//   { source, license, constellations: [{n:和名, p:[ra,dec](ラベル位置), l:[[[ra,dec],...],...]}],
//     asterisms: 同形式 }

const fs = require('fs');
const path = require('path');

// IAU 3文字略符 → 日本語の星座名（88星座）
const COMMON_NAMES = {
  And:'アンドロメダ座', Ant:'ポンプ座', Aps:'ふうちょう座', Aqr:'みずがめ座', Aql:'わし座',
  Ara:'さいだん座', Ari:'おひつじ座', Aur:'ぎょしゃ座', Boo:'うしかい座', Cae:'ちょうこくぐ座',
  Cam:'きりん座', Cnc:'かに座', CVn:'りょうけん座', CMa:'おおいぬ座', CMi:'こいぬ座',
  Cap:'やぎ座', Car:'りゅうこつ座', Cas:'カシオペヤ座', Cen:'ケンタウルス座', Cep:'ケフェウス座',
  Cet:'くじら座', Cha:'カメレオン座', Cir:'コンパス座', Col:'はと座', Com:'かみのけ座',
  CrA:'みなみのかんむり座', CrB:'かんむり座', Crv:'からす座', Crt:'コップ座', Cru:'みなみじゅうじ座',
  Cyg:'はくちょう座', Del:'いるか座', Dor:'かじき座', Dra:'りゅう座', Equ:'こうま座',
  Eri:'エリダヌス座', For:'ろ座', Gem:'ふたご座', Gru:'つる座', Her:'ヘルクレス座',
  Hor:'とけい座', Hya:'うみへび座', Hyi:'みずへび座', Ind:'インディアン座', Lac:'とかげ座',
  Leo:'しし座', LMi:'こじし座', Lep:'うさぎ座', Lib:'てんびん座', Lup:'おおかみ座',
  Lyn:'やまねこ座', Lyr:'こと座', Men:'テーブルさん座', Mic:'けんびきょう座', Mon:'いっかくじゅう座',
  Mus:'はえ座', Nor:'じょうぎ座', Oct:'はちぶんぎ座', Oph:'へびつかい座', Ori:'オリオン座',
  Pav:'くじゃく座', Peg:'ペガスス座', Per:'ペルセウス座', Phe:'ほうおう座', Pic:'がか座',
  Psc:'うお座', PsA:'みなみのうお座', Pup:'とも座', Pyx:'らしんばん座', Ret:'レチクル座',
  Sge:'や座', Sgr:'いて座', Sco:'さそり座', Scl:'ちょうこくしつ座', Sct:'たて座',
  Ser:'へび座', Sex:'ろくぶんぎ座', Tau:'おうし座', Tel:'ぼうえんきょう座', Tri:'さんかく座',
  TrA:'みなみのさんかく座', Tuc:'きょしちょう座', UMa:'おおぐま座', UMi:'こぐま座', Vel:'ほ座',
  Vir:'おとめ座', Vol:'とびうお座', Vul:'こぎつね座',
};

// 日本でなじみのある星の並び（アステリズム）。HIP 番号の折れ線で定義。
// カシオペヤのWは星座線そのものと同形のため入れていない。
const ASTERISMS = [
  // 柄の先(η)→枡(δγβα)→閉じる(α→δ)
  { n:'北斗七星',       lines:[[67301, 65378, 62956, 59774, 58001, 53910, 54061, 59774]] },
  { n:'夏の大三角',     lines:[[91262, 102098, 97649, 91262]] },   // ベガ・デネブ・アルタイル
  { n:'冬の大三角',     lines:[[27989, 32349, 37279, 27989]] },    // ベテルギウス・シリウス・プロキオン
  // 北斗七星の柄の先→アルクトゥルス→スピカ
  { n:'春の大曲線',     lines:[[67301, 69673, 65474]] },
  // シリウス→プロキオン→ポルックス→カペラ→アルデバラン→リゲル→シリウス
  { n:'冬のダイヤモンド', lines:[[32349, 37279, 37826, 24608, 21421, 24436, 32349]] },
];

const [linesPath, hygPath] = process.argv.slice(2);
if(!linesPath || !hygPath){
  console.error('使い方: node tools/make_constellations.js <constellations.lines.jsonパス> <HYGのCSVパス>');
  process.exit(1);
}

const round = v => +v.toFixed(4); // ~21秒角。線の用途には十分

// 頂点集合の重心方向（単位球上で平均して正規化）→ [ra, dec]。ラベル位置に使う
function centroidRaDec(points){
  let x = 0, y = 0, z = 0;
  for(const [ra, dec] of points){
    x += Math.cos(dec) * Math.cos(ra);
    y += Math.cos(dec) * Math.sin(ra);
    z += Math.sin(dec);
  }
  const r = Math.hypot(x, y, z);
  let ra = Math.atan2(y, x);
  if(ra < 0) ra += Math.PI * 2;
  return [round(ra), round(Math.asin(z / r))];
}

// ---- 星座線（GeoJSON: 経度 -180..180 = RA, 緯度 = Dec, 度） ----
const geo = JSON.parse(fs.readFileSync(linesPath, 'utf8'));
const D2R = Math.PI / 180;
const constellations = [];
for(const f of geo.features){
  const abbr = f.id.replace(/\d+$/, ''); // へび座の分割(Ser1/Ser2等)に備えて末尾数字を除去
  const name = COMMON_NAMES[abbr];
  if(!name){ console.error(`未知の星座略符: ${f.id}`); process.exit(1); }
  const lines = [];
  const all = [];
  for(const line of f.geometry.coordinates){
    const pts = line.map(([lon, lat])=>{
      const ra = (lon < 0 ? lon + 360 : lon) * D2R;
      const dec = lat * D2R;
      all.push([ra, dec]);
      return [round(ra), round(dec)];
    });
    if(pts.length >= 2) lines.push(pts);
  }
  constellations.push({ n:name, p:centroidRaDec(all), l:lines });
}

// ---- アステリズム（HIP番号 → HYG CSVの rarad/decrad） ----
const hygLines = fs.readFileSync(hygPath, 'utf8').split('\n');
const header = hygLines[0].split(',');
const iHip = header.indexOf('"hip"') >= 0 ? header.indexOf('"hip"') : header.indexOf('hip');
const iRa = header.indexOf('"rarad"') >= 0 ? header.indexOf('"rarad"') : header.indexOf('rarad');
const iDec = header.indexOf('"decrad"') >= 0 ? header.indexOf('"decrad"') : header.indexOf('decrad');
const need = new Set();
for(const a of ASTERISMS) for(const line of a.lines) for(const hip of line) need.add(hip);
const hipPos = new Map();
for(let i = 1; i < hygLines.length && hipPos.size < need.size; i++){
  const f = hygLines[i].split(','); // 必要列(hip/rarad/decrad)より前にクォート列はないので単純splitで足りる
  const hip = parseInt(f[iHip], 10);
  if(need.has(hip)) hipPos.set(hip, [round(parseFloat(f[iRa])), round(parseFloat(f[iDec]))]);
}
const asterisms = ASTERISMS.map(a => {
  const all = [];
  const lines = a.lines.map(line => line.map(hip => {
    const p = hipPos.get(hip);
    if(!p){ console.error(`HIP ${hip} がHYGに見つかりません`); process.exit(1); }
    all.push(p);
    return p;
  }));
  return { n:a.n, p:centroidRaDec(all), l:lines };
});

const out = {
  source: '星座線: d3-celestial (constellations.lines.json) を変換。原典は IAU 星座図。'
    + ' アステリズム・和名: 自前データ（座標は HYG Database より）',
  license: '星座線: BSD-3-Clause (d3-celestial, Olaf Frohn) / 原典 CC BY 4.0 (IAU)',
  note: '角度は J2000 赤道座標 [rad]。n=名前, p=ラベル位置[ra,dec], l=折れ線の配列',
  constellations,
  asterisms,
};
const outPath = path.join(__dirname, '..', 'constellations.json');
fs.writeFileSync(outPath, JSON.stringify(out).replace(/\},\{/g, '},\n{'));
console.log(`${outPath}: 星座 ${constellations.length} / アステリズム ${asterisms.length}, `
  + `${(fs.statSync(outPath).size/1024).toFixed(0)} KB`);
