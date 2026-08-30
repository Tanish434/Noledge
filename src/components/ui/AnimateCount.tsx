"use client";

import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/utils/cn";

export const ANIMATE_COUNT_DURATION_MS = 450;

const EASING = [0.23, 0.88, 0.26, 0.92] as const;

export interface AnimateCountProps {
  children: number;
  animate?: boolean;
  className?: string;
}

export function AnimateCount({
  children: count,
  animate = true,
  className,
}: AnimateCountProps) {
  const [prev, setPrev] = useState<number | null>(null);
  const [displayCount, setDisplayCount] = useState(count);

  useEffect(() => {
    if (animate) setPrev(displayCount);
    setDisplayCount(count);
  }, [count, animate]);

  return (
    <div
      className={cn(
        "inline-grid place-items-center tabular-nums tracking-tight",
        className
      )}
      style={{
        display: "inline-grid",
        gridTemplateColumns: "1fr",
        gridTemplateRows: "1fr",
        placeItems: "center",
      }}
    >
      <AnimatePresence initial={false}>
        {animate && prev !== null && prev !== displayCount && (
          <motion.div
            key={`exit-${prev}-${displayCount}`}
            aria-hidden
            initial={{ opacity: 1, filter: "blur(0px)", y: 0 }}
            animate={{ opacity: 0, filter: "blur(2px)", y: -12 }}
            transition={{
              duration: ANIMATE_COUNT_DURATION_MS / 1000,
              ease: EASING,
            }}
            onAnimationComplete={() => setPrev(null)}
            style={{ gridColumnStart: 1, gridRowStart: 1 }}
          >
            {prev}
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        key={`enter-${displayCount}`}
        initial={animate ? { opacity: 0, filter: "blur(2px)", y: 8 } : false}
        animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
        transition={{
          duration: ANIMATE_COUNT_DURATION_MS / 1000,
          ease: EASING,
        }}
        style={{ gridColumnStart: 1, gridRowStart: 1 }}
      >
        {displayCount}
      </motion.div>
    </div>
  );
}

export default AnimateCount;
