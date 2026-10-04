import type { TourSpec } from "@/components/guide/GuideTourSheet";
import type { FeatureGuide, SetupItem } from "@/lib/guide/catalog";

export const setupTour = (item: SetupItem): TourSpec => ({
  title: item.title, summary: item.why, steps: item.steps, to: item.to, cta: item.cta,
});
export const featureTour = (g: FeatureGuide): TourSpec => ({
  title: g.title, summary: g.summary, steps: g.steps, to: g.path, cta: g.cta,
});
