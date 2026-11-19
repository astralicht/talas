import Image from 'next/image';
import clsx from 'clsx';

/**
 * Talas wordmark rendered from the brand assets. The light variant (black
 * lettering) shows on light surfaces and the dark variant (white lettering)
 * on dark ones; the orange sparkle reads correctly in both.
 */
export function Logo({ className, alt = 'Talas' }: { className?: string; alt?: string }) {
  return (
    <>
      <Image
        src="/logos/talas-logo-light.png"
        width={1409}
        height={626}
        alt={alt}
        priority
        className={clsx('block dark:hidden', className)}
      />
      <Image
        src="/logos/talas-logo-dark.png"
        width={1409}
        height={626}
        alt={alt}
        priority
        className={clsx('hidden dark:block', className)}
      />
    </>
  );
}

/**
 * Standalone orange sparkle mark from the logo, for decorative accents.
 */
export function Sparkle({ className }: { className?: string }) {
  return (
    <Image src="/logos/talas-sparkle.png" alt="" width={203} height={135} className={className} />
  );
}
