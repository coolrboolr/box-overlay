import { isDev } from "../shared/isDev";

export interface SiteProfile {
  name: string;
  selectors: string[];
  minTextLength: number;
  relaxedAttributePattern: RegExp;
  blockedClassFragments: string[];
}

interface ProfileConfig {
  matcher: RegExp;
  build(): SiteProfile;
}

const DEFAULT_SELECTORS = [
  "article",
  "[role='article']",
  "section[data-component*='card']",
  "[data-testid*='card']",
  "[data-testid*='tile']",
  "[data-testid*='product']",
  "[data-module*='card']",
  "[data-widget*='story']",
  "div[class*='card']",
  "div[class*='tile']",
  ".post",
  ".feed-item",
  ".feed-card",
  ".story-card",
  ".product-card",
  ".listing-card"
];

const DEFAULT_PROFILE: SiteProfile = {
  name: "default",
  selectors: DEFAULT_SELECTORS,
  minTextLength: 60,
  relaxedAttributePattern: /(feed|story|card|product|listing|tile|article)/i,
  blockedClassFragments: ["nav", "menu", "footer", "filter", "breadcrumb"]
};

function withDefault(overrides: Partial<SiteProfile> & { name: string; extraSelectors?: string[] }): SiteProfile {
  const selectorSet = new Set(
    overrides.extraSelectors
      ? [...DEFAULT_PROFILE.selectors, ...overrides.extraSelectors]
      : overrides.selectors ?? DEFAULT_PROFILE.selectors
  );
  return {
    ...DEFAULT_PROFILE,
    ...overrides,
    selectors: Array.from(selectorSet)
  };
}

const profileConfigs: ProfileConfig[] = [
  {
    matcher: /(^|\.)drop\.com$/i,
    build: () =>
      withDefault({
        name: "drop-feed",
        extraSelectors: [
          "[data-testid*='product-card']",
          ".drop-card",
          ".drop-product-card",
          "section[data-component*='drop-card']"
        ],
        minTextLength: 50,
        blockedClassFragments: [...DEFAULT_PROFILE.blockedClassFragments, "filter", "banner"]
      })
  },
  {
    matcher: /(^|\.)bellroy\.com$/i,
    build: () =>
      withDefault({
        name: "bellroy-detail",
        extraSelectors: [
          "section[data-section-type*='story']",
          "[data-component*='story-block']",
          "[data-component*='product-panel']",
          "main [data-testid*='story']"
        ],
        minTextLength: 45
      })
  }
];

let cachedProfile: SiteProfile | null = null;
let loggedProfileName: string | null = null;

export function resolveProfile(url: string): SiteProfile {
  const parsedUrl = new URL(url, globalThis.location?.origin ?? "http://localhost");
  const hostname = parsedUrl.hostname.toLowerCase();
  const match = profileConfigs.find((candidate) => candidate.matcher.test(hostname));
  if (!match) {
    return DEFAULT_PROFILE;
  }
  return match.build();
}

export function getActiveProfile(): SiteProfile {
  if (!cachedProfile) {
    const url = typeof window !== "undefined" ? window.location.href : "http://localhost/";
    cachedProfile = resolveProfile(url);
    if (isDev && cachedProfile.name !== DEFAULT_PROFILE.name && loggedProfileName !== cachedProfile.name) {
      console.info(`[content] using site profile: ${cachedProfile.name}`);
      loggedProfileName = cachedProfile.name;
    }
  }
  return cachedProfile;
}

export function resetProfileCache(): void {
  cachedProfile = null;
  loggedProfileName = null;
}

