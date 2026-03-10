const ACCENT_YELLOW = "#f6d300";
const ACCENT_YELLOW_HOVER = "#f6d300";
const ACCENT_BLACK = "#000000";

export const POI_THEME = {
  accentYellow: ACCENT_YELLOW,
  accentYellowHover: ACCENT_YELLOW_HOVER,
  accentBlack: ACCENT_BLACK,
  markerFrameBackground: ACCENT_YELLOW,
  markerFrameBorder: ACCENT_BLACK,
  labelBackground: "rgba(18, 18, 18, 0.96)",
  labelText: "rgba(248, 248, 244, 0.98)",
  labelBorder: ACCENT_BLACK,
  labelRevealAnimationEnabled: true,
  labelRevealDurationMs: 360,
  labelRevealEasing: "cubic-bezier(0.22, 1, 0.36, 1)",
  labelRevealDistancePx: 12,
  defaultDotFill: ACCENT_YELLOW,
  defaultDotOutline: ACCENT_BLACK,
  dotStylesByEmoji: {}
};

export function applyPoiTheme(root = document.documentElement) {
  if (!root?.style) return;

  root.style.setProperty("--tg-accent-yellow", POI_THEME.accentYellow);
  root.style.setProperty("--tg-accent-yellow-hover", POI_THEME.accentYellowHover);
  root.style.setProperty("--tg-accent-black", POI_THEME.accentBlack);
}
