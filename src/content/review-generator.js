globalThis.JDRAReviewGenerator = (() => {
  const FEATURE_RULES = [
    { group: "sugar", pattern: /0\s*蔗糖|无蔗糖|无糖/u, text: "0蔗糖，甜味不会太重" },
    { group: "ingredients", pattern: /生牛乳.*乳酸菌|乳酸菌.*生牛乳/u, text: "配料主要是生牛乳和乳酸菌" },
    { group: "ingredients", pattern: /配料表.{0,8}(干净|简洁|简单)|(干净|简洁|简单).{0,8}配料表/u, text: "配料表挺简单" },
    { group: "texture", pattern: /(顺滑|丝滑).{0,8}(浓稠|细腻)|(浓稠|细腻).{0,8}(顺滑|丝滑)/u, text: "口感顺滑细腻，稠度也刚好" },
    { group: "texture", pattern: /顺滑|丝滑|细腻/u, text: "口感挺顺滑" },
    { group: "milk", pattern: /奶香.{0,6}(浓|足|纯)|奶味.{0,6}(浓|足|纯)/u, text: "奶香挺足" },
    { group: "taste", pattern: /微酸|酸甜/u, text: "酸甜味挺自然" },
    { group: "taste", pattern: /好喝|顺口|味道.{0,6}(不错|很好)/u, text: "喝起来挺顺口" },
    { group: "sweet", pattern: /不甜腻|甜而不腻|不会太甜/u, text: "甜度刚好，不会腻" },
    { group: "cold", pattern: /冷藏/u, text: "冷藏后更好吃" },
    { group: "pairing", pattern: /搭配.{0,8}(水果|坚果)|拌水果|拌坚果/u, text: "直接吃或者拌水果、坚果都合适" },
    { group: "fresh", pattern: /新鲜|鲜度/u, text: "到手很新鲜" },
    { group: "crisp", pattern: /爽脆|脆甜|酥脆/u, text: "咬起来很脆爽" },
    { group: "sweet", pattern: /甜度.{0,6}(合适|适中|刚好)|香甜/u, text: "甜度刚好" },
    { group: "size", pattern: /个头.{0,6}(均匀|合适|大)|果径|大小均匀/u, text: "大小挺均匀" },
    { group: "package", pattern: /包装.{0,8}(完整|严实|仔细|完好)/u, text: "包装严实，收到时是完整的" },
    { group: "package", pattern: /没有.{0,4}(洒|漏)|不洒|不漏|防漏/u, text: "包装没有洒漏" },
    { group: "portion", pattern: /分量.{0,6}(足|多|够)|份量.{0,6}(足|多|够)/u, text: "分量挺足" },
    { group: "material", pattern: /材质.{0,8}(舒服|舒适|柔软)|触感.{0,8}(舒服|柔软)/u, text: "摸起来柔软，用着也舒服" },
    { group: "workmanship", pattern: /做工.{0,8}(细致|精细|不错|扎实)/u, text: "做工挺细，边角处理得不错" },
    { group: "install", pattern: /安装.{0,8}(方便|简单|容易)/u, text: "安装步骤不复杂" },
    { group: "operation", pattern: /操作.{0,8}(方便|简单)|容易上手/u, text: "操作简单，上手很快" },
    { group: "battery", pattern: /续航.{0,8}(久|不错|稳定|够用)/u, text: "日常用下来续航够用" },
    { group: "connection", pattern: /连接.{0,8}(快|稳定)|蓝牙.{0,8}(稳定|不断)/u, text: "连接很快，用着也稳定" },
    { group: "noise", pattern: /降噪.{0,8}(好|不错|明显|有效)/u, text: "降噪挺明显" },
    { group: "charge", pattern: /充电.{0,8}(快|方便)|快充/u, text: "充电速度挺快" },
    { group: "performance", pattern: /运行.{0,8}(流畅|稳定)|性能.{0,8}(强|不错|稳定)/u, text: "运行流畅，稳定性也可以" },
    { group: "display", pattern: /画质.{0,8}(清晰|细腻)|显示.{0,8}清晰/u, text: "画面清楚，细节看得清" },
    { group: "fit", pattern: /尺寸.{0,8}(合适|刚好)|大小.{0,8}(合适|刚好)/u, text: "尺寸刚好" },
    { group: "portable", pattern: /便携|携带方便|独立包装/u, text: "带出门挺方便" },
    { group: "absorb", pattern: /吸收.{0,8}(快|好)|不黏腻|清爽不黏/u, text: "吸收快，用完不黏" },
    { group: "value", pattern: /性价比/u, text: "这个价位挺划算" },
  ];

  const GENERIC_SENTENCE =
    /收到货|物流很快|卖家描述|非常满意|值得推荐|无限回购|真心推荐|满意的一次购物|质量非常好|物美价廉/u;

  const TOPIC_PATTERNS = [
    /配料|生牛乳|乳酸菌/u,
    /口感|顺滑|细腻|浓稠|脆爽/u,
    /甜|蔗糖|酸甜|微酸/u,
    /奶香|奶味/u,
    /包装|洒漏|防漏/u,
    /分量|份量|大杯/u,
    /材质|面料|触感/u,
    /做工|边角|走线/u,
    /安装/u,
    /操作|上手/u,
    /续航|电量/u,
    /连接|蓝牙/u,
    /降噪/u,
    /充电|快充/u,
    /运行|性能|稳定/u,
    /画质|显示|清晰/u,
    /尺寸|大小|尺码/u,
    /便携|携带/u,
    /吸收|黏腻/u,
    /价格|性价比|划算/u,
  ];

  const PRESET_OPENINGS = [
    "买了{name}，",
    "这次选的是{name}，",
    "{name}拿到后试了试，",
    "看了几款，最后选了{name}，",
    "{name}用下来，",
    "简单说下{name}的感受，",
    "{name}目前用着，",
    "入手的是{name}，",
    "{name}体验了一下，",
    "最近在用{name}，",
  ];

  const PRESET_ENDINGS = [
    "目前没啥问题。",
    "整体挺合适的。",
    "这些细节做得还可以。",
    "这个价位能接受。",
    "平时用着挺省心。",
    "该有的都有。",
    "暂时挑不出什么毛病。",
    "这次没选错。",
    "用下来挺合心意。",
    "我自己还挺喜欢。",
  ];

  const REVIEW_PRESETS = PRESET_OPENINGS.flatMap((opening) =>
    PRESET_ENDINGS.map((ending) => ({ opening, ending })),
  );

  function generate(task, context) {
    const productName = cleanText(task?.productName || context?.productName);
    const skuText = cleanText(task?.skuText);
    const tags = [...new Set((context?.tags || []).map(normalizeTag).filter(Boolean))];
    const reviewTexts = (context?.reviews || [])
      .map((review) => cleanText(review?.text))
      .filter(Boolean);
    const sourceText = [...tags, ...reviewTexts].join("。 ");
    const sourceClauses = selectSpecificClauses(reviewTexts);
    const sourceClause = sourceClauses[0] || "";
    const features = selectFeatures(sourceText).filter(
      (feature) =>
        !sourceClause ||
        (!isSimilar(feature, sourceClause) && !hasTopicOverlap(feature, sourceClause)),
    );

    if (features.length < 3) {
      features.push(
        ...sourceClauses.slice(1).filter(
          (clause) =>
            !features.some(
              (feature) =>
                isSimilar(feature, clause) || hasTopicOverlap(feature, clause),
            ),
        ),
      );
    }

    if (features.length < 3) {
      features.push(
        ...tags.filter(
          (tag) =>
            (!sourceClause || !hasTopicOverlap(tag, sourceClause)) &&
            !features.some(
              (feature) => isSimilar(feature, tag) || hasTopicOverlap(feature, tag),
            ),
        ),
      );
    }

    const selected = [...new Set(features)].slice(0, sourceClause ? 3 : 4);
    if (sourceClause) selected.push(sourceClause);

    const presetIndex = stableIndex(
      `${task?.orderId || ""}${task?.productId || ""}${productName}${skuText}${sourceText}`,
      REVIEW_PRESETS.length,
    );
    const preset = REVIEW_PRESETS[presetIndex];
    if (selected.length === 0) {
      return generateCategoryFallback(productName, skuText, preset);
    }

    const intro = formatPresetIntro(productName, skuText, preset.opening);
    const detailSentence = formatDetails(selected, presetIndex % 2);
    return `${intro}${detailSentence}${adaptEnding(preset.ending, productName)}`.slice(
      0,
      500,
    );
  }

  function selectFeatures(sourceText) {
    const groups = new Set();
    const features = [];
    for (const rule of FEATURE_RULES) {
      if (groups.has(rule.group) || !rule.pattern.test(sourceText)) continue;
      groups.add(rule.group);
      features.push(rule.text);
    }
    return features;
  }

  function selectSpecificClauses(reviewTexts) {
    return reviewTexts
      .flatMap((text) => text.split(/[。！？；!?]/u))
      .map(rewriteClause)
      .filter((text) => text.length >= 9 && text.length <= 42)
      .filter((text) => !GENERIC_SENTENCE.test(text))
      .sort((left, right) => scoreClause(right) - scoreClause(left))
      .filter((text, index, values) =>
        values.slice(0, index).every((previous) => !isSimilar(previous, text)),
      )
      .slice(0, 3);
  }

  function rewriteClause(value) {
    return cleanText(value)
      .replace(/^(这款|这个|商品|宝贝|收到后|实际使用下来)[，,\s]*/u, "")
      .replace(/非常|特别|超级|比较/gu, "挺")
      .replace(/真的|确实/gu, "")
      .replace(/[，,]?(值得推荐|真心推荐|无限回购).*$/u, "")
      .replace(/[，。；、]+$/u, "")
      .trim();
  }

  function scoreClause(value) {
    let score = value.length >= 12 && value.length <= 32 ? 3 : 0;
    if (/\d|%|蔗糖|配料|材质|做工|尺寸|口感|续航|安装|性能|包装/u.test(value)) {
      score += 3;
    }
    if (/方便|顺滑|浓稠|柔软|清晰|稳定|新鲜|脆爽/u.test(value)) score += 2;
    return score;
  }

  function normalizeTag(value) {
    return cleanText(value)
      .replace(/[\s\u00a0]*\d+[\s\u00a0]*$/u, "")
      .replace(/[，。；、]+$/u, "")
      .trim();
  }

  function formatDetails(features, seed) {
    if (features.length === 1) return `${features[0]}。`;
    if (features.length === 2) return `${features[0]}，${features[1]}。`;
    if (features.length === 3 && seed === 0) return `${features.join("，")}。`;
    return `${features.slice(0, 2).join("，")}。${features.slice(2).join("，")}。`;
  }

  function generateCategoryFallback(productName, skuText, preset) {
    const intro = formatPresetIntro(productName, skuText, preset.opening);
    const isLargeServing = /大杯|大份|加大|家庭装/u.test(
      `${productName} ${skuText}`,
    );

    if (/槐花粉/u.test(productName)) {
      return `${intro}入口细滑，甜度刚好，冰一下吃更清爽。${
        isLargeServing ? "大杯分量挺足，" : "分量正合适，"
      }包装也稳当，拿到手没有洒。${adaptEnding(preset.ending, productName)}`.slice(
        0,
        500,
      );
    }

    if (/酸奶|牛奶|奶酪|饮料|果汁|咖啡|奶茶|甜品|零食|饼干|面包|蛋糕|水果|肉|粉|面|饭|糕/u.test(productName)) {
      return `${intro}味道不会太甜，口感也不错。包装完整，分量合适，打开后保存也方便。${adaptEnding(preset.ending, productName)}`.slice(
        0,
        500,
      );
    }

    if (/衣|裤|鞋|袜|帽|内衣|外套|衬衫|裙/u.test(productName)) {
      return `${intro}尺码合适，版型上身不别扭。面料摸着舒服，走线也整齐。${adaptEnding(preset.ending, productName)}`.slice(
        0,
        500,
      );
    }

    if (/手机|电脑|耳机|平板|显示器|键盘|鼠标|相机|充电|电器|风扇|灯/u.test(productName)) {
      return `${intro}连接很快，操作不绕，用了一会儿也挺稳定。常用功能都有。${adaptEnding(preset.ending, productName)}`.slice(
        0,
        500,
      );
    }

    if (/洗发|护发|面膜|乳液|面霜|精华|护肤|化妆|沐浴|牙膏/u.test(productName)) {
      return `${intro}质地不厚重，抹开后吸收挺快，味道也不会太冲。包装完整，取用方便。${adaptEnding(preset.ending, productName)}`.slice(
        0,
        500,
      );
    }

    return `${intro}尺寸合适，做工看着规整，平时用起来也顺手。包装完整，没有明显磕碰。${adaptEnding(preset.ending, productName)}`.slice(
      0,
      500,
    );
  }

  function formatPresetIntro(productName, skuText, opening) {
    const normalizedName = normalizeProductName(productName, skuText);
    const namePart = normalizedName || "这件商品";
    const skuPart = skuText && !namePart.includes(skuText) ? `，选的${skuText}` : "";
    return opening.replace("{name}", `${namePart}${skuPart}`);
  }

  function normalizeProductName(productName, skuText) {
    let value = cleanText(productName);
    if (skuText && value.endsWith(skuText)) {
      value = value.slice(0, -skuText.length).trim();
    }
    return value
      .replace(/[【\[].*?[】\]]/gu, "")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 40);
  }

  function stableIndex(value, size) {
    let hash = 0;
    for (const char of value) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return hash % size;
  }

  function hasTopicOverlap(left, right) {
    return TOPIC_PATTERNS.some(
      (pattern) => pattern.test(left) && pattern.test(right),
    );
  }

  function adaptEnding(ending, productName) {
    if (/奶|水果|饮料|肉|零食|饼干|面包|蛋糕|甜品|粉|面|饭|糕/u.test(productName)) {
      return ending.replace(/用着|用下来/gu, "吃着");
    }
    if (/衣|裤|鞋|袜|帽|内衣|外套|衬衫|裙/u.test(productName)) {
      return ending.replace(/用着|用下来/gu, "穿着");
    }
    return ending;
  }

  function isSimilar(left, right) {
    const leftChars = new Set(left.replace(/[，。；、\s]/gu, ""));
    const rightChars = new Set(right.replace(/[，。；、\s]/gu, ""));
    if (leftChars.size === 0 || rightChars.size === 0) return false;
    const overlap = [...leftChars].filter((char) => rightChars.has(char)).length;
    return overlap / Math.min(leftChars.size, rightChars.size) >= 0.72;
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/gu, " ").trim();
  }

  return { generate, presetCount: REVIEW_PRESETS.length };
})();
