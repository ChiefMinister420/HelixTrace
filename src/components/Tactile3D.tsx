import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type HTMLMotionProps,
} from 'motion/react';

type CardIntensity = 'compact' | 'panel' | 'subtle';

interface TactileCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  intensity?: CardIntensity;
  interactiveScale?: boolean;
}

const TILT_CONFIG: Record<CardIntensity, { maxDeg: number; scale: number; lift: number }> = {
  compact: { maxDeg: 3.2, scale: 1.018, lift: -3 },
  panel: { maxDeg: 1.15, scale: 1.005, lift: -2 },
  subtle: { maxDeg: 1.8, scale: 1.01, lift: -2 },
};

const SPRING_CONFIG = { stiffness: 340, damping: 28, mass: 0.6 };

/**
 * GPU-composited 3D perspective card powered by MotionValues + springs.
 * Updates rotateX/rotateY smoothly without triggering React re-renders.
 */
export function TactileCard({
  children,
  className = '',
  intensity = 'panel',
  interactiveScale = true,
  onMouseMove,
  onMouseLeave,
  style,
  ...rest
}: TactileCardProps) {
  const prefersReduced = useReducedMotion();
  const cfg = TILT_CONFIG[intensity];

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);

  const rawRotateX = useTransform(pointerY, [-0.5, 0.5], [cfg.maxDeg, -cfg.maxDeg]);
  const rawRotateY = useTransform(pointerX, [-0.5, 0.5], [-cfg.maxDeg, cfg.maxDeg]);

  const rotateX = useSpring(rawRotateX, SPRING_CONFIG);
  const rotateY = useSpring(rawRotateY, SPRING_CONFIG);

  const handleMouseMove = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!prefersReduced) {
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const nx = (e.clientX - rect.left) / rect.width - 0.5;
        const ny = (e.clientY - rect.top) / rect.height - 0.5;
        pointerX.set(nx);
        pointerY.set(ny);
      }
    }
    onMouseMove?.(e);
  };

  const handleMouseLeave = (e: ReactMouseEvent<HTMLDivElement>) => {
    pointerX.set(0);
    pointerY.set(0);
    onMouseLeave?.(e);
  };

  return (
    <motion.div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      whileHover={
        prefersReduced || !interactiveScale
          ? undefined
          : {
              scale: cfg.scale,
              y: cfg.lift,
              transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
            }
      }
      style={{
        transformPerspective: 1000,
        rotateX: prefersReduced ? 0 : rotateX,
        rotateY: prefersReduced ? 0 : rotateY,
        willChange: prefersReduced ? undefined : 'transform',
        ...style,
      }}
      className={`plate-3d ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

interface TactileButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: ReactNode;
  tiltDeg?: number;
}

/**
 * High-precision instrument button with hover-triggered perspective tilt,
 * subtle scale lift, and physical press depression.
 */
export function TactileButton({
  children,
  className = '',
  disabled,
  tiltDeg = 4,
  style,
  type = 'button',
  ...rest
}: TactileButtonProps) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.button
      type={type}
      disabled={disabled}
      whileHover={
        disabled || prefersReduced
          ? undefined
          : {
              y: -2,
              scale: 1.022,
              rotateX: tiltDeg,
              transition: { duration: 0.15, ease: [0.16, 1, 0.3, 1] },
            }
      }
      whileTap={
        disabled || prefersReduced
          ? undefined
          : {
              y: 1.5,
              scale: 0.975,
              rotateX: -2,
              transition: { duration: 0.08, ease: 'easeOut' },
            }
      }
      style={{
        transformPerspective: 680,
        willChange: prefersReduced ? undefined : 'transform',
        ...style,
      }}
      className={className}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

interface TactileSegmentButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: ReactNode;
}

export function TactileSegmentButton({
  children,
  className = '',
  disabled,
  style,
  type = 'button',
  ...rest
}: TactileSegmentButtonProps) {
  const prefersReduced = useReducedMotion();

  return (
    <motion.button
      type={type}
      disabled={disabled}
      whileHover={
        disabled || prefersReduced
          ? undefined
          : {
              scale: 1.03,
              y: -0.5,
              transition: { duration: 0.14, ease: [0.16, 1, 0.3, 1] },
            }
      }
      whileTap={
        disabled || prefersReduced
          ? undefined
          : {
              scale: 0.96,
              y: 0.5,
              transition: { duration: 0.08 },
            }
      }
      style={{
        transformPerspective: 500,
        ...style,
      }}
      className={className}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
