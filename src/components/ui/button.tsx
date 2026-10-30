import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

// outline-none also sets --tw-outline-style: none, which outline-2 reads back:
// without outline-solid the focus ring computes to no outline at all
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-none border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // disabled, the ink lifts: a faded fill still read as a button to press in the darkroom
        default:
          "bg-primary text-primary-foreground hover:bg-z5 disabled:border-input disabled:bg-transparent disabled:text-foreground dark:hover:bg-z4",
        outline:
          "border-input bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-muted",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        // under the safelight: reserved for confirming a destructive or production write
        destructive:
          "bg-safelight font-semibold text-safelight-foreground hover:bg-safelight/90 focus-visible:outline-safelight disabled:border-destructive disabled:bg-transparent disabled:text-destructive",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
