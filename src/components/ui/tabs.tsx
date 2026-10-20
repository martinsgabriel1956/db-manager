import * as React from "react";
import { cn } from "cn";
import { Tabs as TabsPrimitive } from "radix-ui";

/** Radix tabs: arrow keys, Home/End and tab ↔ panel wiring come from the primitive. */
function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={className} {...props} />;
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List data-slot="tabs-list" className={cn("flex gap-1", className)} {...props} />
  );
}

/** Underlined tab for view headers. */
function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "border-b-2 border-transparent px-2 py-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-[state=active]:border-select data-[state=active]:font-semibold data-[state=active]:text-foreground",
        className
      )}
      {...props}
    />
  );
}

/**
 * `forceMount` keeps an inactive panel in the DOM (hidden), so its state survives
 * switching; without it the panel mounts only while active.
 */
function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    // tabIndex -1: every panel here starts with controls, so the panel itself would be an
    // empty tab stop (Radix makes it 0); it stays focusable from script
    <TabsPrimitive.Content
      data-slot="tabs-content"
      tabIndex={-1}
      className={cn("outline-none data-[state=inactive]:hidden", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
