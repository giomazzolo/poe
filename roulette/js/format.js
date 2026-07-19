const HIDDEN_TYPES = new Set([
  "Trappable",
  "Totemable",
  "Mineable",
  "Multicastable",
  "Triggerable",
  "CanRapidFire",
  "Cascadable",
  "TotemCastsAlone",
  "ProjectilesFromUser",
  "ProjectilesNotFromUser",
  "Multistrikeable",
  "ThresholdJewelArea",
  "MirageArcherCanUse",
  "AND",
  "OR",
]);

const TYPE_LABELS = {
  MeleeSingleTarget: "Strike",
  DamageOverTime: "Duration",
  CreatesMinion: "Minion",
  Area: "AoE",
  RemoteMined: "Mine",
  Triggers: "Trigger",
};

const WEAPON_PLURALS = {
  Claw: "Claws",
  Dagger: "Daggers",
  "One Hand Sword": "One Hand Swords",
  "Thrusting One Hand Sword": "Thrusting One Hand Swords",
  "One Hand Axe": "One Hand Axes",
  "One Hand Mace": "One Hand Maces",
  Sceptre: "Sceptres",
  Staff: "Staves",
  "Two Hand Sword": "Two Hand Swords",
  "Two Hand Axe": "Two Hand Axes",
  "Two Hand Mace": "Two Hand Maces",
  Warstaff: "Warstaves",
  "Rune Dagger": "Rune Daggers",
  Bow: "Bows",
  Wand: "Wands",
  Shield: "Shields",
  Unarmed: "Unarmed",
};

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function baseIdFromSkill(skill) {
  return skill.id.replace(/_alt_[xyz]$/, "");
}

export function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatTags(skill, detail) {
  // Gem display tags (attack, melee, strike) match the in-game gem, not internal types.
  if (skill.tags?.length) {
    return skill.tags
      .filter((tag) => !["strength", "dexterity", "intelligence", "grants_active_skill"].includes(tag))
      .map((tag) => TYPE_LABELS[tag] || titleCase(tag))
      .slice(0, 8);
  }

  const raw = detail?.types?.length
    ? detail.types
        .filter((type) => !HIDDEN_TYPES.has(type))
        .map((type) => TYPE_LABELS[type] || type)
    : [];

  return raw.slice(0, 8);
}

export function formatCastTime(ms) {
  if (ms == null) return null;
  return `${(ms / 1000).toFixed(2)} sec`;
}

export function formatCrit(critChance) {
  if (critChance == null) return null;
  return `${(critChance / 100).toFixed(2)}%`;
}

export function formatCooldown(ms) {
  if (ms == null) return null;
  return `${(ms / 1000).toFixed(2)} sec`;
}

export function formatAttackSpeed(multiplier) {
  if (multiplier == null) return null;
  return `${100 + multiplier}% of base`;
}

export function formatRange(low, high, suffix = "") {
  if (low == null && high == null) return null;
  const fmt = (n) => {
    if (typeof n !== "number") return n;
    // Gem tooltips show whole numbers for damage / effectiveness ranges
    return String(Math.round(n));
  };
  if (low === high || high == null) return `${fmt(low)}${suffix}`;
  return `(${fmt(low)}–${fmt(high)})${suffix}`;
}

export function formatRequirements(level1, level20) {
  const lvlLow = level1?.requiredLevel ?? null;
  const lvlHigh = level20?.requiredLevel ?? lvlLow;
  if (lvlLow == null) return "";

  const mergeAttr = (key) => {
    const a = level1?.statRequirements?.[key] ?? 0;
    const b = level20?.statRequirements?.[key] ?? a;
    if (!a && !b) return null;
    const label = key === "str" ? "Str" : key === "dex" ? "Dex" : "Int";
    return a === b ? `${a} ${label}` : `(${a}–${b}) ${label}`;
  };

  const attrs = ["str", "dex", "int"].map(mergeAttr).filter(Boolean);
  const levelText =
    lvlLow === lvlHigh ? `Level ${lvlLow}` : `Level (${lvlLow}–${lvlHigh})`;
  return attrs.length
    ? `Requires ${levelText}, ${attrs.join(", ")}`
    : `Requires ${levelText}`;
}

export function formatCosts(level1, level20) {
  const c1 = level1?.costs || {};
  const c20 = level20?.costs || {};
  const keys = [...new Set([...Object.keys(c1), ...Object.keys(c20)])];
  if (!keys.length) return null;

  return keys
    .map((key) => {
      const a = c1[key];
      const b = c20[key] ?? a;
      if (a == null && b == null) return null;
      const label = key.replace(/([a-z])([A-Z])/g, "$1 $2");
      return `Cost: ${formatRange(a, b, ` ${label}`)}`;
    })
    .filter(Boolean)
    .join("\n");
}

export function formatDamageLine(level1, level20) {
  const p1 = level1?.baseDamagePercent;
  const p20 = level20?.baseDamagePercent ?? p1;
  if (p1 == null && p20 == null) return null;
  return `Attack Damage: ${formatRange(p1, p20, "% of base")}`;
}

export function formatEffectiveness(level1, level20) {
  const e1 = level1?.damageEffectiveness;
  const e20 = level20?.damageEffectiveness ?? e1;
  if (e1 == null && e20 == null) return null;
  return `Effectiveness of Added Damage: ${formatRange(e1, e20, "%")}`;
}

export function formatWeapons(restrictions) {
  if (!restrictions?.length) return "";
  return restrictions
    .map((name) => WEAPON_PLURALS[name] || name)
    .join(", ");
}

export function cleanStatText(line) {
  if (!line) return "";
  return titleCaseStatWords(
    line
      .replace(/\{([^}/]+)(?:\/[^}]+)?\}/g, "n")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** PoE gem mod style: capitalise the first letter of each word. */
export function titleCaseStatWords(line) {
  if (!line) return "";
  return line.replace(/[A-Za-z][A-Za-z']*/g, (word) => {
    if (word.length === 1) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

const NUMBER_RE = /-?\d+(?:\.\d+)?/g;

/** Merge gem level 1 and 20 stat lines into in-game (low–high) ranges. */
export function mergeStatLines(line1, line20) {
  const a = (line1 || "").trim();
  const b = (line20 || "").trim();
  if (!a) return b;
  if (!b) return a;
  if (a === b) return a;

  const numsA = [...a.matchAll(NUMBER_RE)].map((m) => m[0]);
  const numsB = [...b.matchAll(NUMBER_RE)].map((m) => m[0]);
  if (!numsA.length || numsA.length !== numsB.length) return b;

  let index = 0;
  const templateA = a.replace(NUMBER_RE, () => `\0${index++}\0`);
  index = 0;
  const templateB = b.replace(NUMBER_RE, () => `\0${index++}\0`);
  if (templateA !== templateB) return b;

  return templateA.replace(/\0(\d+)\0/g, (_, i) => {
    const low = numsA[Number(i)];
    const high = numsB[Number(i)];
    return low === high ? low : `(${low}–${high})`;
  });
}

/**
 * Pair level-1 and level-20 stat text arrays into ranged lines.
 * Extra lines that only exist at one level are kept as-is.
 */
export function mergeStatTextLists(level1Lines = [], level20Lines = []) {
  const toList = (value) => {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  };

  const a = toList(level1Lines);
  const b = toList(level20Lines);
  const len = Math.max(a.length, b.length);
  const merged = [];

  for (let i = 0; i < len; i++) {
    const left = a[i];
    const right = b[i];
    if (left && right) merged.push(mergeStatLines(left, right));
    else merged.push(right || left);
  }

  return merged.filter(Boolean);
}

function formatQualityValue(raw, handlers = []) {
  let value = raw;
  if (value == null) return null;

  if (handlers.includes("locations_to_metres")) {
    value = ((value / 1000) * 20) / 10;
  } else if (handlers.some((h) => h.startsWith("divide_by_one_hundred"))) {
    value = ((value / 1000) * 20) / 100;
  } else if (handlers.some((h) => h.startsWith("divide_by_"))) {
    const handler = handlers.find((h) => h.startsWith("divide_by_"));
    const divisor = Number(
      handler.replace(/^divide_by_/, "").replace(/_\ddp$/, "")
    );
    value = divisor ? ((value / 1000) * 20) / divisor : (value / 1000) * 20;
  } else {
    // Thousandths of a percent (or unit) per 1% quality → value at 20% quality
    value = (value / 1000) * 20;
  }

  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 100) / 100);
}

/**
 * Resolve quality template placeholders using RePoE quality_stats values.
 * Substituted amounts are shown as (0–max) ranges, matching gem tooltips.
 */
export function formatQualityLine(template, stats = {}) {
  if (!template) return "";

  let text = template.replace(/\{([^}]+)\}/g, (_, token) => {
    const [statId, ...handlers] = token.split("/");
    const formatted = formatQualityValue(stats[statId], handlers);
    if (formatted == null) return "(0–n)";
    return `(0–${formatted})`;
  });

  text = text.replace(/\s+/g, " ").trim();

  // Templates with no placeholders but a leading amount still get a 0–max range
  if (!template.includes("{") && /^\+?\d/.test(text)) {
    text = text.replace(/^([+\-]?)(\d+(?:\.\d+)?)(%?)/, "($1$2–$1$2)$3");
    // Prefer (0–X) when the baked text is the max quality effect
    text = text.replace(/^\(([+\-]?)(\d+(?:\.\d+)?)\–\1\2\)/, "(0–$1$2)");
  }

  return titleCaseStatWords(text);
}

export function resolveQualityLines(detail) {
  const templates = detail?.qualityStatText || [];
  let valuesList = detail?.qualityStatValues || [];

  // Normalize: some serializers may store a single map instead of [map]
  if (valuesList && !Array.isArray(valuesList)) {
    valuesList = [valuesList];
  }

  return templates.map((template, index) => {
    const stats = valuesList[index] || {};
    if (stats && Object.keys(stats).length) {
      return formatQualityLine(template, stats);
    }
    return cleanStatText(template).replace(/^n%/, "(0–n)%");
  });
}

export function isReminderLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("(") && trimmed.endsWith(")");
}

export function splitPropLine(text) {
  const idx = text.indexOf(":");
  if (idx === -1) return { label: text, value: "" };
  return {
    label: text.slice(0, idx + 1),
    value: text.slice(idx + 1).trim(),
  };
}

/** In-game reminder strings attached to common mechanics (PoEDB / client). */
const REMINDERS_BY_HINT = [
  {
    test: /fortify|fortification/i,
    lines: [
      "(Fortifying grants an amount of Fortification based on the Damage of the Hit)",
      "(Take 1% less Damage from Hits per Fortification. Maximum 20 Fortification)",
    ],
  },
  {
    test: /wither(?!ing step)/i,
    lines: [
      "(Withered applies 6% increased Chaos Damage Taken, and can be inflicted up to 15 times)",
    ],
  },
  {
    test: /\bshock/i,
    lines: [
      "(Shock increases Damage taken by 15%, for 2 seconds, by default)",
    ],
  },
  {
    test: /\bignite/i,
    lines: [
      "(Ignite deals Fire Damage over time, based on the base Fire Damage of the Skill, for 4 seconds)",
    ],
  },
  {
    test: /\bchill\b/i,
    lines: [
      "(Chill reduces Enemy Action Speed by up to 30%, slowing them for 2 seconds, by default)",
    ],
  },
  {
    test: /\bfreeze|\bfrozen\b/i,
    lines: [
      "(Freeze lowers Enemy Action Speed to zero, preventing them from acting. Duration is based on the Cold Damage of the Hit)",
    ],
  },
  {
    test: /\bbrittle\b/i,
    lines: [
      "(Brittle increases Critical Strike Chance against the Enemy, and lasts for 4 seconds, by default)",
    ],
  },
  {
    test: /\bsap\b/i,
    lines: [
      "(Sap reduces Enemy Damage dealt by 15%, for 4 seconds, by default)",
    ],
  },
  {
    test: /\bscorch/i,
    lines: [
      "(Scorch reduces Enemy Elemental Resistances by 15%, for 4 seconds, by default)",
    ],
  },
  {
    test: /\bintimidate/i,
    lines: [
      "(Intimidated Enemies take 10% increased Attack Damage)",
    ],
  },
  {
    test: /\bunnerve/i,
    lines: [
      "(Unnerved Enemies take 10% increased Spell Damage)",
    ],
  },
  {
    test: /\bcover.*ash|covered in ash/i,
    lines: [
      "(Being Covered in Ash applies 20% less Movement Speed and 20% increased Fire Damage Taken)",
    ],
  },
  {
    test: /\bblind/i,
    lines: [
      "(Being Blinded causes 50% less Accuracy Rating and Evasion Rating, for 4 seconds)",
    ],
  },
  {
    test: /\bmaim\b/i,
    lines: [
      "(Maimed enemies have 30% reduced Movement Speed)",
    ],
  },
  {
    test: /\bhinder\b/i,
    lines: [
      "(Hinder reduces Movement Speed by 30%, for 4 seconds, by default)",
    ],
  },
];

export function reminderLinesForStats(statLines, description = "") {
  const haystack = [...statLines, description].filter(Boolean);
  const reminders = [];
  const seen = new Set();
  for (const line of haystack) {
    for (const entry of REMINDERS_BY_HINT) {
      if (!entry.test.test(line)) continue;
      for (const reminder of entry.lines) {
        if (seen.has(reminder)) continue;
        seen.add(reminder);
        reminders.push(reminder);
      }
    }
  }
  return reminders;
}
