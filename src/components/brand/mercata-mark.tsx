import Image from "next/image";
import { cn } from "@/lib/cn";

type MercataMarkProps = {
  className?: string;
  /** Reverse gold mark for dark navy surfaces */
  inverted?: boolean;
  size?: number;
  priority?: boolean;
};

/** Small arch mark — sidebar + login only. Do not use elsewhere in the console. */
export function MercataMark({
  className,
  size = 28,
  priority = false,
}: MercataMarkProps) {
  return (
    <Image
      src="/brand/mercata-notext.webp"
      alt="Mercata"
      width={size}
      height={size}
      priority={priority}
      className={cn("block shrink-0", className)}
    />
  );
}
