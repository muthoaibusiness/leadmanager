import { cn } from '../../lib/utils.js';
import { Progress as ProgressPrimitive } from 'radix-ui';

// Progress primitives (adapted from a shadcn/Tailwind .tsx to this project's
// plain-JSX + CSS stack). Linear Progress uses radix; Circle/Radial are pure SVG.
// Tailwind utility classes replaced with .prog-* CSS (theme-token colors).
function Progress({ className, indicatorClassName, value, ...props }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn('prog', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn('prog-ind', indicatorClassName)}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

function ProgressCircle({
  className,
  indicatorClassName,
  trackClassName,
  value = 0,
  size = 48,
  strokeWidth = 4,
  children,
  ...props
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div
      data-slot="progress-circle"
      className={cn('prog-c', className)}
      style={{ width: size, height: size }}
      {...props}
    >
      <svg className="prog-c-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          data-slot="progress-circle-track"
          cx={size / 2} cy={size / 2} r={radius}
          stroke="currentColor" strokeWidth={strokeWidth} fill="none"
          className={cn('prog-track', trackClassName)}
        />
        <circle
          data-slot="progress-circle-indicator"
          cx={size / 2} cy={size / 2} r={radius}
          stroke="currentColor" strokeWidth={strokeWidth} fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          className={cn('prog-ind-c', indicatorClassName)}
        />
      </svg>
      {children && (
        <div data-slot="progress-circle-content" className="prog-c-content">{children}</div>
      )}
    </div>
  );
}

function ProgressRadial({
  className,
  value = 0,
  size = 120,
  strokeWidth = 8,
  startAngle = -90,
  endAngle = 90,
  showLabel = false,
  trackClassName,
  indicatorClassName,
  children,
  ...props
}) {
  const radius = (size - strokeWidth) / 2;
  const angleRange = endAngle - startAngle;
  const progressAngle = (value / 100) * angleRange;
  const toRadians = (deg) => (deg * Math.PI) / 180;

  const startX = size / 2 + radius * Math.cos(toRadians(startAngle));
  const startY = size / 2 + radius * Math.sin(toRadians(startAngle));
  const endX = size / 2 + radius * Math.cos(toRadians(startAngle + progressAngle));
  const endY = size / 2 + radius * Math.sin(toRadians(startAngle + progressAngle));
  const largeArc = progressAngle > 180 ? 1 : 0;
  const pathData = ['M', startX, startY, 'A', radius, radius, 0, largeArc, 1, endX, endY].join(' ');

  return (
    <div
      data-slot="progress-radial"
      className={cn('prog-c', className)}
      style={{ width: size, height: size }}
      {...props}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <path
          d={[
            'M', size / 2 + radius * Math.cos(toRadians(startAngle)), size / 2 + radius * Math.sin(toRadians(startAngle)),
            'A', radius, radius, 0, angleRange > 180 ? 1 : 0, 1,
            size / 2 + radius * Math.cos(toRadians(endAngle)), size / 2 + radius * Math.sin(toRadians(endAngle)),
          ].join(' ')}
          stroke="currentColor" strokeWidth={strokeWidth} fill="none" strokeLinecap="round"
          className={cn('prog-track', trackClassName)}
        />
        <path
          d={pathData}
          stroke="currentColor" strokeWidth={strokeWidth} fill="none" strokeLinecap="round"
          className={cn('prog-ind-c', indicatorClassName)}
        />
      </svg>
      {(showLabel || children) && (
        <div className="prog-radial-content">
          {children || <span className="prog-radial-label">{value}%</span>}
        </div>
      )}
    </div>
  );
}

export { Progress, ProgressCircle, ProgressRadial };
