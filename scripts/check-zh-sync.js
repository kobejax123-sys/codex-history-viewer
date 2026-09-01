/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

// 检查「作者更新后 zh 是否同步」。覆盖：
//   1. package.json 中 ui.en.* 与 ui.zh.* 命令一一对应
//   2. 菜单 when 的 ja/zh/en 三态互斥完整（en 项须含 != 'zh'，且须有 zh 变体）
//   3. 语言化子菜单（*Submenu.{en,ja,zh}）三位置项数一致
//   4. commandPalette 覆盖所有 ui.zh.* 命令
//   5. settings 面板 ui.language 含 zh 选项（bundle key 存在）
// 纯文本翻译遗漏（bundle/nls key 对齐）由 npm run check:l10n 负责。

let failed = false;
const report = (msg) => {
  failed = true;
  console.error(`[check:zh-sync] ${msg}`);
};
const warn = (msg) => console.warn(`[check:zh-sync] ${msg}`);

function readJson(rel) {
  const full = path.join(process.cwd(), rel);
  if (!fs.existsSync(full)) {
    report(`Missing file: ${rel}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (err) {
    report(`Invalid JSON: ${rel}`);
    return null;
  }
}

const pkg = readJson("package.json");
if (pkg) {
  // ---------- 1. ui.en.* / ui.ja.* / ui.zh.* 命令配对 ----------
  const cmds = pkg.contributes?.commands || [];
  const namesByLang = (lang) =>
    new Map(
      cmds
        .filter((c) => c.command?.startsWith(`codexHistoryViewer.ui.${lang}.`))
        .map((c) => [c.command.replace(`codexHistoryViewer.ui.${lang}.`, ""), c]),
    );
  const en = namesByLang("en");
  const ja = namesByLang("ja");
  const zh = namesByLang("zh");

  for (const name of en.keys()) {
    if (!zh.has(name)) report(`ui.zh 命令缺失: ${name}（ui.en title: "${en.get(name).title}"）`);
  }
  for (const name of zh.keys()) {
    if (!en.has(name)) report(`ui.zh 命令多余（ui.en 无对应）: ${name}`);
  }
  // 作者可能临时新增 ui.en 未加 ui.ja，仅提示不阻断
  if (en.size !== ja.size) {
    warn(`ui.en(${en.size}) 与 ui.ja(${ja.size}) 命令数量不一致——请确认作者是否只加了英文命令`);
  }

  // ---------- 2. 菜单 when 三态互斥（普通位置） ----------
  const menus = pkg.contributes?.menus || {};
  for (const [loc, items] of Object.entries(menus)) {
    if (/Submenu\.(en|ja|zh)$/.test(loc)) continue; // 语言化子菜单单独查
    for (const it of items) {
      const w = it.when || "";
      if (!w.includes("uiLang")) continue;
      if (w.includes("== 'ja'") || w.includes("== 'zh'")) continue; // ja/zh 项无需处理
      if (!w.includes("!= 'ja'")) {
        report(`when 含 uiLang 但非 ja/zh/en 判断（${loc}）: ${it.command || it.submenu} -> ${w}`);
        continue;
      }
      // en 项：须已补 != 'zh'，且须存在 zh 变体
      if (!w.includes("!= 'zh'")) report(`when 缺 "!= 'zh'"（${loc}）: ${it.command || it.submenu} -> ${w}`);
      const zhTarget =
        (it.command ? it.command.replace(/\.en\./, ".zh.") : "") ||
        (it.submenu ? it.submenu.replace(/\.en$/, ".zh") : "");
      if (!zhTarget) continue;
      const hasZh = items.some(
        (o) =>
          (o.command === zhTarget || o.submenu === zhTarget) &&
          (o.when || "").includes("== 'zh'"),
      );
      if (!hasZh) report(`缺 zh 变体（${loc}）: ${it.command || it.submenu}`);
    }
  }

  // ---------- 3. 语言化子菜单三位置对齐 ----------
  const submenuBases = [
    ...new Set(
      Object.keys(menus)
        .filter((l) => /Submenu\.(en|ja|zh)$/.test(l))
        .map((l) => l.replace(/\.(en|ja|zh)$/, "")),
    ),
  ];
  for (const base of submenuBases) {
    const locs = ["ja", "en", "zh"].map((s) => `${base}.${s}`);
    for (const l of locs) if (!menus[l]) report(`子菜单位置缺失: ${l}`);
    const [a, b, c] = locs.map((l) => menus[l]);
    if (a && b && c && (a.length !== b.length || a.length !== c.length)) {
      report(`子菜单 ${base} 项数不一致: ja=${a.length} en=${b.length} zh=${c.length}`);
    }
  }

  // ---------- 4. commandPalette 覆盖 ui.zh 命令 ----------
  const cp = menus.commandPalette || [];
  const cpTargets = new Set(cp.map((i) => i.command).filter(Boolean));
  for (const name of zh.keys()) {
    const id = `codexHistoryViewer.ui.zh.${name}`;
    if (!cpTargets.has(id)) report(`commandPalette 缺 ui.zh 项: ${id}`);
  }
}

// ---------- 5. settings 面板 zh 选项 key ----------
const enBundle = readJson("l10n/bundle.l10n.json");
if (enBundle && !enBundle["settingsPanel.option.ui.language.zh.label"]) {
  report('bundle.l10n.json 缺 settingsPanel.option.ui.language.zh.label（settings 面板语言选择器需 zh 选项）');
}
const zhBundle = readJson("l10n/bundle.l10n.zh.json");
if (zhBundle && !zhBundle["settingsPanel.option.ui.language.zh.label"]) {
  report('bundle.l10n.zh.json 缺 settingsPanel.option.ui.language.zh.label');
}

if (failed) {
  process.exitCode = 1;
  console.error("[check:zh-sync] Failed.");
} else {
  console.log("[check:zh-sync] OK");
}
