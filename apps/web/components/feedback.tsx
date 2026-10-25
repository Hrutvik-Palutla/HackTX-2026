"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { motionTokens, springs } from "@/lib/motion-tokens";

export function Feedback({
  message,
  error = false,
  busy = false,
  onRetry,
}: {
  message: string;
  error?: boolean;
  busy?: boolean;
  onRetry?: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.div
          key={`${error ? "error" : "notice"}:${message}`}
          role={error ? "alert" : "status"}
          className={`feedback${error ? " error" : ""}`}
          initial={{ opacity: 0, y: reduced ? 0 : motionTokens.distance.xs }}
          animate={{ opacity: 1, y: 0 }}
          exit={{
            opacity: 0,
            y: reduced ? 0 : -motionTokens.distance.xs,
            transition: {
              duration: reduced
                ? motionTokens.duration.instant
                : motionTokens.duration.fast,
            },
          }}
          transition={
            reduced
              ? { duration: motionTokens.duration.instant }
              : springs.snappy
          }
        >
          <span>{message}</span>
          {onRetry && (
            <button className="secondary" disabled={busy} onClick={onRetry}>
              Retry
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
