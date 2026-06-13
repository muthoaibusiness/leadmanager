// Minimal `cn` — shadcn uses clsx + tailwind-merge, but this project has neither
// Tailwind nor those deps, so we just join truthy class names.
export function cn(...args) {
  return args.flat(Infinity).filter(Boolean).join(' ');
}
