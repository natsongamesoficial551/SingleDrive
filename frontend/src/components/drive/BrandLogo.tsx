import { cn } from '@/lib/utils'
export function BrandLogo({ className }: { className?: string }) {
  return <div className={cn('sd-logo flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', className)}><svg viewBox="0 0 40 40" className="h-7 w-7" role="img" aria-label="SingleDrive"><path d="M29 10H16a6 6 0 0 0 0 12h8a4 4 0 0 1 0 8H11" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" /><path d="m25 6 5 4-5 4M15 26l-5 4 5 4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
}
