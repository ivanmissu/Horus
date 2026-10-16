// Local UI preview only. Never available in a production build, even if the flag is set.
export function isPreviewMode() {
  return process.env.NODE_ENV === "development" && process.env.HORUS_PREVIEW_MODE === "true";
}
