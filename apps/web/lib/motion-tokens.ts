// Shared values from the supplied ECC motion-foundations skill.
export const motionTokens = {
  duration: { instant: 0.08, fast: 0.18, normal: 0.35 },
  distance: { xs: 4, sm: 8 },
  scale: { subtle: 0.98, press: 0.95 },
} as const;
export const springs = {
  snappy: { type: "spring", stiffness: 300, damping: 30 },
} as const;
