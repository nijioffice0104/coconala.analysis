#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { evaluate, navigate, withCdpPage } from "./cdp-bridge.mjs";

const DEFAULT_URL = "";

function decodeEntities(value = "") {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToText(html = "") {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\r]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function clean(value = "") {
  return htmlToText(value).replace(/\s+/g, " ").trim();
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractProfileRating(text) {
  // ランク説明にも「評価4.8以上」が出るため、プロフィール概要の
  // 「販売実績 → 評価」を優先して読む。
  const summaryRating = firstMatch(text, [
    /販売実績\s*\d+\s*評価\s*([0-5](?:\.\d)?)/,
    /販売実績\s*\d+[\s\S]{0,80}?評価\s*([0-5](?:\.\d)?)/
  ]);
  if (summaryRating != null) return numberOrNull(summaryRating);
  return numberOrNull(firstMatch(text, [/評価\s*([0-5](?:\.\d)?)/]));
}

function numberOrNull(value) {
  if (value == null) return null;
  const match = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function extractAnchors(html, baseUrl) {
  const anchors = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const url = new URL(decodeEntities(match[1]), baseUrl).href;
      anchors.push({ url, text: clean(match[2]) });
    } catch {
      // Invalid or JavaScript-only links are not useful to this MVP.
    }
  }
  return anchors;
}

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function extractServices(html, baseUrl, limit = Infinity) {
  const anchors = uniqueBy(
    extractAnchors(html, baseUrl).filter((item) => /\/services\/\d+/.test(item.url) && item.text),
    (item) => item.url.split("?")[0]
  ).slice(0, limit);

  return anchors.map((item) => {
    const position = html.indexOf(new URL(item.url).pathname);
    const nearby = clean(html.slice(Math.max(0, position - 250), position + 1500));
    return {
      title: item.text,
      url: item.url,
      rating: firstMatch(nearby, [/([0-5](?:\.\d)?)\s*実績/])
        ? numberOrNull(firstMatch(nearby, [/([0-5](?:\.\d)?)\s*実績/]))
        : null,
      salesCount: numberOrNull(firstMatch(nearby, [/実績\s*(\d+)\s*件/])),
      priceYen: numberOrNull(firstMatch(nearby, [/(\d[\d,]*)\s*円/]))
    };
  });
}

function extractContents(html, baseUrl) {
  return uniqueBy(
    extractAnchors(html, baseUrl)
      .filter((item) => /\/contents\//.test(item.url) && item.text)
      .map((item) => ({ title: item.text, url: item.url })),
    (item) => item.url.split("?")[0]
  );
}

function extractProfile(html, url) {
  const text = htmlToText(html);
  const title = firstMatch(html, [/<title[^>]*>([\s\S]*?)<\/title>/i]);
  const description = firstMatch(html, [
    /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i,
    /<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i
  ]);
  const profileName = firstMatch(text, [/^([^\n]{2,80})さん\s*\(/m]);
  const serviceCountShown = numberOrNull(firstMatch(text, [/出品サービス\s*[（(](\d+)件/]));
  const services = extractServices(html, url, serviceCountShown ?? (/\/users\//.test(new URL(url).pathname) ? 20 : 1));
  const contents = extractContents(html, url);

  return {
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
    pageType: /\/users\//.test(new URL(url).pathname) ? "profile" : "service_or_other",
    profileName,
    pageTitle: title ? clean(title) : null,
    description: description ? clean(description) : null,
    rank: firstMatch(text, [/出品者ランク：?\s*([^\n]+)/]),
    status: firstMatch(text, [/稼働状況\s*([^\n]+)/]),
    salesTotal: numberOrNull(firstMatch(text, [/販売実績\s*(\d+)/])),
    rating: extractProfileRating(text),
    followers: numberOrNull(firstMatch(text, [/フォロワー\s*(\d+)/])),
    serviceCountShown,
    contentCountShown: numberOrNull(firstMatch(text, [/出品コンテンツ\s*[（(](\d+)件/])),
    services,
    contents,
    publicTextLength: text.length,
    limitations: [
      "公開ページから取得できる情報だけを対象にしています。",
      "閲覧数・期間別販売数などの出品者専用分析値は、このURLからは取得していません。",
      "ページの表示仕様が変更された場合、抽出結果の再検証が必要です。"
    ]
  };
}

function includesAny(value, words) {
  return words.filter((word) => value.includes(word));
}

function classifyService(service) {
  const title = service.title || "";
  const price = service.priceYen;
  const marketingSignals = includesAny(title, ["Canva", "集客", "SNS", "インスタ", "Instagram", "LP", "動画", "テンプレ", "デザイン"]);
  // 「占い師」「鑑定テンプレ」のような提供者向け商品を、鑑定購入者向けと誤分類しない。
  const spiritualSignals = includesAny(title, ["霊視", "神", "仏", "天使", "宇宙", "金運", "縁結び", "鑑定", "守護"]);
  const tier = price == null
    ? "価格未取得"
    : price >= 20000
      ? "本命候補"
      : price >= 3000
        ? "ミドル候補"
        : "入口候補";

  return {
    ...service,
    tier,
    category: marketingSignals.length && spiritualSignals.length
      ? "複合"
      : marketingSignals.length
        ? "集客・制作"
        : spiritualSignals.length
          ? "占い・スピリチュアル"
          : "その他",
    audience: marketingSignals.length && !spiritualSignals.length
      ? "占い師・事業者"
      : spiritualSignals.length && !marketingSignals.length
        ? "占いを受けたい人"
        : marketingSignals.length && spiritualSignals.length
          ? "両方の可能性"
          : "未分類",
    signals: [...new Set([...marketingSignals, ...spiritualSignals])]
  };
}

function formatServiceLabel(service) {
  return service?.title ? `「${service.title}」` : "サービス";
}

function buildStrategy(data) {
  const services = (data.services || []).map(classifyService);
  const knownSales = services.filter((service) => service.salesCount != null);
  const topServices = [...knownSales]
    .sort((a, b) => (b.salesCount ?? -1) - (a.salesCount ?? -1))
    .slice(0, 3);
  const entryServices = services.filter((service) => service.tier === "入口候補");
  const coreServices = services.filter((service) => service.tier === "本命候補");
  const marketingServices = services.filter((service) => service.category === "集客・制作" || service.category === "複合");
  const spiritualServices = services.filter((service) => service.category === "占い・スピリチュアル" || service.category === "複合");
  const seekerServices = services.filter((service) => service.audience === "占いを受けたい人");
  const providerServices = services.filter((service) => service.audience === "占い師・事業者");
  const description = data.description || "";
  const positioningSignals = includesAny(`${data.profileName || ""} ${description}`, ["占い師", "カウンセラー", "集客", "AI", "Canva", "テンプレート", "マーケティング"]);
  const hasTwoPriceClusters = entryServices.length > 0 && coreServices.length > 0;

  const positioning = {
    label: "推論",
    flag: positioningSignals.length
      ? "占い・カウンセリング領域の人に、AI×Canvaなどで集客・発信を仕組み化する専門家"
      : "公開プロフィールの説明を軸にした専門サービス提供者",
    tribe: positioningSignals.includes("占い師") || positioningSignals.includes("カウンセラー")
      ? "発信や集客を続けたい占い師・カウンセラー"
      : "プロフィールの課題を解決したいココナラ購入者",
    change: "何を発信・出品すればよいか迷う状態から、用途別の商品と素材で行動できる状態へ",
    evidence: [
      data.profileName ? `プロフィール名: ${data.profileName}` : null,
      positioningSignals.length ? `公開説明・名称に含まれるシグナル: ${positioningSignals.join(" / ")}` : null,
      marketingServices.length ? `集客・制作系サービス: ${marketingServices.length}件` : null
    ].filter(Boolean)
  };

  const portfolio = {
    label: "公開事実＋推論",
    mix: [
      { name: "入口候補", count: entryServices.length, meaning: "低価格で接点を作る商品" },
      { name: "ミドル候補", count: services.filter((service) => service.tier === "ミドル候補").length, meaning: "比較検討を進める商品" },
      { name: "本命候補", count: coreServices.length, meaning: "高単価で大きな変化を提供する商品" },
      { name: "価格未取得", count: services.filter((service) => service.tier === "価格未取得").length, meaning: "判定保留" }
    ].filter((item) => item.count > 0),
    observation: hasTwoPriceClusters
      ? `低価格の入口候補${entryServices.length}件と、高価格の本命候補${coreServices.length}件が同じ一覧にあります。`
      : "公開価格だけでは、商品構成をまだ決められません。",
    interpretation: hasTwoPriceClusters
      ? "入口商品から本命商品へ進む橋（説明文・関連記事・購入後提案）が見えるかを最優先で確認する。"
      : "価格だけで商品階段を決めず、サービス説明と購入後導線を追加確認する。",
    evidence: [
      entryServices.length ? `入口候補: ${entryServices.map(formatServiceLabel).slice(0, 2).join("、")}` : null,
      coreServices.length ? `本命候補: ${coreServices.map(formatServiceLabel).slice(0, 2).join("、")}` : null,
      topServices.length ? `公開実績上位: ${topServices.map((service) => `${formatServiceLabel(service)} ${service.salesCount}件`).join("、")}` : null
    ].filter(Boolean)
  };

  const mixedAudiences = seekerServices.length > 0 && providerServices.length > 0;
  const decision = {
    label: "まず決めること",
    title: mixedAudiences
      ? "いま決めるべきは、価格より「誰を本命顧客にするか」"
      : "本命顧客と商品階段の一致を確認する",
    copy: mixedAudiences
      ? `公開タイトル上、${seekerServices.length}件が「占いを受けたい人」向け、${providerServices.length}件が「占い師・事業者」向けです。両者は悩みも購入後の変化も違うため、同じ店舗の導線では評価が混線します。`
      : "サービス名だけで顧客層を確定できないため、説明文・レビュー・実際の購入者情報で補正します。",
    evidence: [
      `占いを受けたい人向け: ${seekerServices.length}件`,
      `占い師・事業者向け: ${providerServices.length}件`,
      providerServices.length ? `本命候補: ${providerServices.filter((service) => service.tier === "本命候補").map(formatServiceLabel).join("、") || "なし"}` : null
    ].filter(Boolean),
    options: mixedAudiences
      ? [
          { name: "A / 集客支援を本命にする", detail: "占い師向け商品を主役にし、占い鑑定群は別店舗・別導線へ分ける。高単価商品から逆算しやすい。", kpi: "占い師向けサービスの閲覧→相談→販売" },
          { name: "B / 鑑定を本命にする", detail: "霊視・ガチャ群を主役にし、集客支援は別店舗・別導線へ分ける。公開実績の強い入口を活かせる。", kpi: "鑑定サービスの閲覧→お気に入り→販売・再購入" },
          { name: "C / 30日だけ分岐テスト", detail: "プロフィールの主見出しと案内を片方に寄せ、期間を固定して反応を比較する。変更は一度に1つ。", kpi: "各段階の閲覧数・お気に入り・購入数" }
        ]
      : [{ name: "追加確認", detail: "サービス説明と購入者の声を読み、顧客層と本命商品の一致を確認する。", kpi: "顧客層別の閲覧・販売・継続" }]
  };

  const funnel = {
    label: "未計測を含む診断",
    stages: [
      { name: "知ってもらう", value: data.followers, status: data.followers == null ? "未計測" : "公開値" },
      { name: "商品ページを見る", value: null, status: "未計測" },
      { name: "気になる・相談", value: null, status: "未計測" },
      { name: "購入", value: data.salesTotal, status: data.salesTotal == null ? "未計測" : "公開値" },
      { name: "もう一度買う", value: null, status: "未計測" }
    ],
    firstHole: "商品ページを見る → 気になる・相談 → 購入の数字がまだ分からない",
    why: "公開販売実績だけでは、何人が見て、気になって、購入したのかを分けて確認できないため。",
    nextMeasurement: "ログイン後のサービス別分析から、閲覧数・お気に入り数・販売数を同じ期間で記録する。"
  };

  const verdict = topServices.length && hasTwoPriceClusters
    ? `現時点の判断: ${formatServiceLabel(topServices[0])}など低価格商品の反応を入口の勝ち筋候補として使い、本命候補へ橋をつくる。まず閲覧→お気に入り→販売を測る。`
    : "現時点の判断: 公開情報だけでは勝ち筋を断定せず、サービス別の閲覧・お気に入り・販売を揃えてから一手を決める。";

  const actions = [
    {
      rank: 1,
      title: "まず売れるまでの流れを確認する",
      reason: funnel.why,
      evidence: `公開値は販売実績${data.salesTotal ?? "未取得"}件までで、閲覧・お気に入りは未計測。`,
      kpi: "サービス別の閲覧数／お気に入り数／購入数／見られて→購入につながった割合",
      measurement: funnel.nextMeasurement,
      stop: "2〜4週間測っても閲覧があるのにお気に入り・販売が動かない商品は、説明・価格・導線の仮説を1つだけ変更する。"
    },
    {
      rank: 2,
      title: hasTwoPriceClusters ? "入口商品と本命商品の橋を見せる" : "商品ごとの役割を明示する",
      reason: "一覧に並ぶ商品を、購入者が次に何を買うかまで理解できる構造にするため。",
      evidence: portfolio.observation,
      kpi: "本命候補の閲覧数・お気に入り数・相談数、入口→本命の遷移",
      measurement: "プロフィール・各サービスに役割と次の一手を追記し、変更前後を同じ期間で比較する。",
      stop: "橋を追加しても本命候補への遷移が増えない場合は、橋の文言ではなく対象顧客・オファーの組み合わせを再検討する。"
    },
    {
      rank: 3,
      title: "公開実績上位のテーマを入口で再現する",
      reason: "売れた商品は、購入者が反応したテーマの観測データになるため。",
      evidence: topServices.length
        ? `上位: ${topServices.map((service) => `${formatServiceLabel(service)} ${service.salesCount}件`).join("、")}`
        : "公開実績が取得できたサービスがないため、判定保留。",
      kpi: "上位テーマを使った新規入口商品の閲覧数・お気に入り数・販売数",
      measurement: "テーマ・価格・訴求のうち1要素だけを変えた商品を作り、専用分析で比較する。",
      stop: "実績が少ない場合は勝ち筋と断定せず、閲覧数・お気に入り数が揃うまで仮説扱いにする。"
    }
  ];

  return {
    verdict,
    decision,
    positioning,
    portfolio,
    funnel,
    actions,
    guardrail: "これは公開情報からの仮説です。価格変更・出品停止などの最終判断は、ログイン後の数字と本人の運用事情を確認してから行います。"
  };
}

function markdownTable(rows) {
  if (!rows.length) return "（取得できませんでした）";
  return [
    "| 項目 | 値 |",
    "|---|---|",
    ...rows.map(([key, value]) => `| ${key} | ${String(value ?? "未取得").replaceAll("|", "\\|")} |`)
  ].join("\n");
}

function toMarkdown(data) {
  const strategy = data.strategy || buildStrategy(data);
  const facts = [
    ["ページ種別", data.pageType],
    ["プロフィール名", data.profileName],
    ["出品者ランク", data.rank],
    ["稼働状況", data.status],
    ["販売実績（公開値）", data.salesTotal == null ? null : `${data.salesTotal}件`],
    ["評価（公開値）", data.rating],
    ["フォロワー（公開値）", data.followers],
    ["表示上の出品サービス数", data.serviceCountShown],
    ["表示上の出品コンテンツ数", data.contentCountShown]
  ];
  const services = data.services.length
    ? data.services.map((service, index) =>
        `| ${index + 1} | [${service.title}](${service.url}) | ${service.priceYen == null ? "未取得" : `${service.priceYen.toLocaleString()}円`} | ${service.salesCount ?? "未取得"} | ${service.rating ?? "未取得"} |`
      ).join("\n")
    : "| - | 取得できませんでした | - | - | - |";
  const contents = data.contents.length
    ? data.contents.map((content, index) => `| ${index + 1} | [${content.title}](${content.url}) |`).join("\n")
    : "| - | 取得できませんでした |";

  return `# ココナラ公開ページ分析レポート

- 取得日時: ${data.fetchedAt}
- 対象URL: ${data.sourceUrl}
- 取得方法: APIなし・公開HTML

## 公開事実

${markdownTable(facts)}

## 出品サービス

| No. | サービス名 | 価格 | 公開実績 | 評価 |
|---:|---|---:|---:|---:|
${services}

## 戦略分析：公開データから見えた仮説

### 誰向けか

- ${strategy.positioning.flag}
- 想定する相手: ${strategy.positioning.tribe}
- 起こす変化: ${strategy.positioning.change}
- 根拠: ${strategy.positioning.evidence.join(" / ") || "公開根拠が不足"}

### 商品構成

${strategy.portfolio.observation}

${strategy.portfolio.interpretation}

- ${strategy.portfolio.evidence.join("\n- ") || "公開根拠が不足"}

### まず決めること

**${strategy.decision.title}**

${strategy.decision.copy}

- ${strategy.decision.evidence.join("\n- ")}

${strategy.decision.options.map((option) => `- **${option.name}**: ${option.detail} 見る数字: ${option.kpi}`).join("\n")}

### 売れるまでの流れで、最初に確認する場所

- ${strategy.funnel.firstHole}
- 理由: ${strategy.funnel.why}
- 次に測るもの: ${strategy.funnel.nextMeasurement}

### 次の一手

${strategy.actions.map((action) => `${action.rank}. **${action.title}**\n   - 根拠: ${action.evidence}\n   - 見る数字: ${action.kpi}\n   - 確認方法: ${action.measurement}\n   - 停止・見直し条件: ${action.stop}`).join("\n")}

> ${strategy.guardrail}

## 出品コンテンツ

| No. | コンテンツ名 |
|---:|---|
${contents}

## 取得範囲と注意

${data.limitations.map((item) => `- ${item}`).join("\n")}

## 次の分析候補

- サービス名・価格・公開実績をカテゴリ別に整理する
- 個別サービスの説明文とレビューを取得して、訴求の共通点を抽出する
- 出品者本人のログイン済み分析画面から、公開値と期間内の数字を別々に記録する

このレポートの公開事実と解釈は分離して扱い、取得できなかった数値を推測で補完しないでください。
`;
}

function parseArgs(argv) {
  const args = { url: DEFAULT_URL, out: "reports" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--url") args.url = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
    else if (!argv[i].startsWith("--")) args.url = argv[i];
  }
  return args;
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; CoconalaURLAnalyzer/0.1; +local-tool)",
        accept: "text/html,application/xhtml+xml"
      }
    });
    if (!response.ok) throw new Error(`ページ取得に失敗しました: HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPageViaBrowser(url) {
  return withCdpPage(async (connection) => {
    await navigate(connection, url);
    const html = await evaluate(connection, "document.documentElement?.outerHTML || \"\"");
    if (!html || html.length < 200) throw new Error("ブラウザで公開ページを読み取れませんでした。");
    return html;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let url;
  try {
    url = new URL(args.url);
    if (!/(^|\.)coconala\.com$/i.test(url.hostname)) throw new Error("ココナラのURLを指定してください。");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  console.log(`公開ページを確認中: ${url.href}`);
  const html = await fetchPage(url.href);
  const data = extractProfile(html, url.href);
  data.strategy = buildStrategy(data);
  const stamp = data.fetchedAt.replace(/[-:TZ.]/g, "").slice(0, 14);
  const dir = resolve(args.out);
  await mkdir(dir, { recursive: true });
  const base = resolve(dir, `coconala-${basename(url.pathname).replace(/[^\w-]/g, "") || "analysis"}-${stamp}`);
  await writeFile(`${base}.json`, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await writeFile(`${base}.md`, toMarkdown(data), "utf8");
  console.log(`JSON: ${base}.json`);
  console.log(`レポート: ${base}.md`);
}

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}`) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

export { buildStrategy, extractProfile, extractProfileRating, fetchPage, fetchPageViaBrowser, htmlToText, toMarkdown };
