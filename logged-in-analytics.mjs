import { evaluate, navigate, waitForNuxtState, withCdpPage } from "./cdp-bridge.mjs";

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const match = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function valueAt(object, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => current?.[key], object);
    if (value != null && value !== "") return value;
  }
  const keys = paths.map((path) => path.split(".").at(-1));
  return findNestedValue(object, keys);
}

function findNestedValue(object, keys, depth = 0) {
  if (object == null || depth > 7 || typeof object !== "object") return null;
  if (Array.isArray(object)) {
    for (const item of object) {
      const value = findNestedValue(item, keys, depth + 1);
      if (value != null && value !== "") return value;
    }
    return null;
  }
  for (const key of keys) {
    if (object[key] != null && object[key] !== "") return object[key];
  }
  for (const value of Object.values(object)) {
    const nested = findNestedValue(value, keys, depth + 1);
    if (nested != null && nested !== "") return nested;
  }
  return null;
}

function normalizeService(item, detail = {}) {
  const overview = item.overview || item.service || item;
  return {
    id: String(valueAt(item, ["id", "serviceId"]) ?? valueAt(overview, ["id", "serviceId"]) ?? ""),
    title: valueAt(item, ["title", "name", "serviceName"]) || valueAt(overview, ["title", "name", "serviceName"]) || "名称未取得",
    priceYen: numberOrNull(valueAt(item, ["price", "priceYen"]) ?? valueAt(overview, ["price", "priceYen"])),
    views: numberOrNull(valueAt(detail, ["numberOfView", "views", "viewCount"])),
    sales: numberOrNull(valueAt(detail, ["numberOfSale", "sales", "saleCount"])),
    favorites: numberOrNull(valueAt(detail, ["numberOfFavorite", "favorites", "favoriteCount"])),
    beginOfDate: valueAt(detail, ["beginOfDate", "period.begin", "begin"]),
    endOfDate: valueAt(detail, ["endOfDate", "period.end", "end"])
  };
}

function parseServicesList(raw) {
  if (Array.isArray(raw)) return raw;
  const list = valueAt(raw, ["servicesList", "services"]);
  if (Array.isArray(list)) return list;
  return [];
}

function recommendServiceAction(service) {
  const { views, favorites, sales, cvr } = service;
  const hasViews = views != null;
  const hasFavorites = favorites != null;
  const hasSales = sales != null;

  if (!hasViews || !hasFavorites || !hasSales) {
    return {
      title: "数字を確認",
      detail: "この商品の数字がそろっていないため、まず分析画面を読み込み直します。",
      target: "分析画面"
    };
  }
  if (views === 0) {
    return {
      title: "入口を見直す",
      detail: "商品ページがまだ見られていません。タイトル・画像・プロフィールからの導線を1つ見直します。",
      target: "タイトル・画像"
    };
  }
  if (sales === 0 && views < 20) {
    return {
      title: "まず見てもらう",
      detail: "見られた回数が少ないため、タイトルやカテゴリ、プロフィールからのリンクを確認します。",
      target: "タイトル・カテゴリ"
    };
  }
  if (sales === 0 && favorites > 0) {
    return {
      title: "購入前の不安を減らす",
      detail: "お気に入りまで進んでいます。内容・納品物・対象者・購入後の変化を分かりやすくします。",
      target: "説明・安心材料"
    };
  }
  if (sales === 0) {
    return {
      title: "気になる理由を作る",
      detail: "見られているものの反応が少なめです。冒頭3行とサムネイルで「自分向け」を伝えます。",
      target: "冒頭・サムネイル"
    };
  }
  if (cvr != null && cvr < 0.03) {
    return {
      title: "購入前の不安を減らす",
      detail: "購入は出ていますが、見られた回数に対して少なめです。説明や購入後のイメージを1つ補強します。",
      target: "説明・安心材料"
    };
  }
  return {
    title: "売れた要素を残す",
    detail: "購入につながっています。タイトル・価格・説明の共通点を、別の商品にも1つ試します。",
    target: "売れた要素"
  };
}

function buildLoggedInAnalysis(snapshot) {
  const services = (snapshot.services || []).map((service) => {
    const views = service.views;
    const sales = service.sales;
    const favorites = service.favorites;
    return {
      ...service,
      cvr: views > 0 && sales != null ? sales / views : null,
      favoriteRate: views > 0 && favorites != null ? favorites / views : null,
      favoriteToSaleRate: favorites > 0 && sales != null ? sales / favorites : null,
      estimatedRevenue: service.priceYen != null && sales != null ? service.priceYen * sales : null
    };
  });
  services.forEach((service) => {
    service.nextAction = recommendServiceAction(service);
  });
  const known = services.filter((service) => service.views != null || service.sales != null || service.favorites != null);
  const complete = services.filter((service) => service.views != null && service.sales != null && service.favorites != null);
  const incomplete = services.filter((service) => service.views == null || service.sales == null || service.favorites == null);
  const unknown = services.filter((service) => service.views == null && service.sales == null && service.favorites == null);
  const total = (key) => {
    const values = known.map((service) => service[key]).filter((value) => value != null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const totalViews = total("views");
  const totalSales = total("sales");
  const totalFavorites = total("favorites");
  const totalRevenue = total("estimatedRevenue");
  const topSales = [...known].sort((a, b) => (b.sales ?? -1) - (a.sales ?? -1)).slice(0, 3);
  const highViewsNoSales = known.filter((service) => (service.views ?? 0) > 0 && service.sales === 0).sort((a, b) => b.views - a.views).slice(0, 5);
  const highFavoritesNoSales = known.filter((service) => (service.favorites ?? 0) > 0 && service.sales === 0).sort((a, b) => b.favorites - a.favorites).slice(0, 5);
  const period = {
    begin: snapshot.period?.begin || services.find((service) => service.beginOfDate)?.beginOfDate || null,
    end: snapshot.period?.end || services.find((service) => service.endOfDate)?.endOfDate || null
  };

  let diagnosis;
  if (totalViews == null) {
    diagnosis = "サービスごとの閲覧数が取れていないため、見られていないのか、見られても購入されていないのかを判別できません。";
  } else if (unknown.length >= Math.ceil(services.length / 2)) {
    diagnosis = `${unknown.length}件の商品で詳細数字を取得できていません。ココナラ側の読み込み待ち、または分析画面の対象期間を確認してから、もう一度実行してください。`;
  } else if (highViewsNoSales.length) {
    diagnosis = `見られているのに購入0件の商品が${highViewsNoSales.length}件あります。まず商品ページの説明・安心材料・価格・購入ボタン周辺を1つずつ見直します。`;
  } else if (incomplete.length) {
    diagnosis = `${incomplete.length}件の商品で一部の数字が未取得です。未取得の数字を確認してから、購入されていない理由を判断します。`;
  } else if (totalFavorites != null && totalFavorites > 0 && totalSales === 0) {
    diagnosis = "お気に入りには入っていますが、まだ購入につながっていません。購入前の不安を解消する情報が次の確認対象です。";
  } else {
    diagnosis = "期間内のサービス別データが揃いました。購入につながった商品の共通点を残し、他の商品を1つずつ見直します。";
  }

  const actions = [
    {
      rank: 1,
      title: highViewsNoSales.length ? "見られているのに購入されない商品を1つ改善" : "見られて購入につながる商品を特定",
      reason: highViewsNoSales.length ? `${highViewsNoSales.map((service) => service.title).join("、")}は見られていますが購入0件です。` : "サービスごとの閲覧数と購入数を同じ期間で比較します。",
      kpi: "見られた回数・お気に入り・購入数",
      measurement: "商品説明の冒頭、安心材料、価格、購入ボタン周辺のうち1つだけ変更して次の期間と比較"
    },
    {
      rank: 2,
      title: highFavoritesNoSales.length ? "お気に入り止まりの商品で不安要因を確認" : "お気に入りから購入への流れを確認",
      reason: highFavoritesNoSales.length ? `${highFavoritesNoSales.map((service) => service.title).join("、")}はお気に入りに入っています。関心はあるものの、最後の決め手が不足している可能性があります。` : "お気に入りに入ったあと、購入まで進んでいるか確認します。",
      kpi: "お気に入りに入った数・購入数",
      measurement: "FAQ・納品物・対象者・購入後の変化を明記し、同じ期間で比較"
    },
    {
      rank: 3,
      title: "購入につながった商品の共通点を次の商品にも試す",
      reason: topSales.length ? `購入数が多いのは${topSales.map((service) => `${service.title}（${service.sales}件）`).join("、")}です。` : "購入数の上位商品が判定できないため、追加確認が必要です。",
      kpi: "共通点を試した商品の見られた回数・購入数",
      measurement: "テーマ・価格・見出し・証拠のうち1要素だけを移植して検証"
    }
  ];

  return {
    mode: "logged-in",
    capturedAt: snapshot.capturedAt || new Date().toISOString(),
    period,
    summary: { totalViews, totalSales, totalFavorites, totalRevenue, serviceCount: services.length, measuredServiceCount: complete.length, partialServiceCount: incomplete.length - unknown.length, unknownServiceCount: unknown.length },
    services,
    diagnosis,
    actions,
    privateData: {
      title: "公開ページとの違い",
      points: [
        "公開ページでは分からない、選んだ期間の閲覧数が分かります。",
        "お気に入りに入った数と、購入まで進んだ数をサービスごとに比べられます。",
        "見られていないのか、気になったけれど購入されていないのかを分けて考えられます。"
      ]
    },
    limitations: [
      "ココナラにログインした状態の分析画面から取得した数字です。",
      "集計期間はココナラ側の選択範囲（過去30日など）に依存します。",
      unknown.length ? `${unknown.length}件はサービス名だけ取得でき、閲覧・お気に入り・購入の数字は取得できませんでした。` : "すべてのサービスで閲覧・お気に入り・購入の数字を確認できました。",
      "購入0件だけで失敗と決めず、見られた回数・公開期間・お気に入りと合わせて判断します。"
    ]
  };
}

async function collectLoggedInAnalytics({ endpoint } = {}) {
  return withCdpPage(async (connection) => {
    await navigate(connection, "https://coconala.com/mypage/analytics");
    const overview = await waitForNuxtState(connection, "window.__NUXT__?.state?.pages?.analytics?.services?.servicesList || null");
    if (!overview) throw new Error("分析画面のデータが見つかりません。ココナラにログインし、出品者の分析画面を開ける状態にしてください。");
    const list = parseServicesList(overview);
    if (!list.length) throw new Error("分析対象のサービス一覧が取得できませんでした。1号アカウントを確認してください。");
    const services = [];
    for (const item of list) {
      const id = valueAt(item, ["id", "serviceId"]) ?? valueAt(item.overview || {}, ["id", "serviceId"]);
      if (id == null) continue;
      await navigate(connection, `https://coconala.com/mypage/analytics/${encodeURIComponent(id)}`);
      const expectedId = JSON.stringify(String(id));
      const detailExpression = `(() => { const detail = window.__NUXT__?.state?.pages?.analytics?.serviceAnalytics || null; if (!detail) return null; const raw = JSON.stringify(detail); const hasMetric = /numberOfView|numberOfSale|numberOfFavorite|viewCount|saleCount|favoriteCount|views|sales|favorites/.test(raw); const hasId = !detail.id && !detail.serviceId || String(detail.id ?? detail.serviceId) === ${expectedId} || raw.includes(${expectedId}); return hasMetric && hasId ? detail : null; })()`;
      const detail = await waitForNuxtState(connection, detailExpression);
      services.push(normalizeService(item, detail || {}));
    }
    return buildLoggedInAnalysis({ capturedAt: new Date().toISOString(), services });
  }, endpoint);
}

export { buildLoggedInAnalysis, collectLoggedInAnalytics, normalizeService, recommendServiceAction };
