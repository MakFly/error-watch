"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronRight, type LucideIcon } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

interface NavItem {
  title: string
  url: string
  icon?: LucideIcon
  isActive?: boolean
  children?: {
    title: string
    url: string
    isActive?: boolean
  }[]
}

export function NavMain({ items, label }: { items: NavItem[]; label?: string }) {
  if (items.length === 0) return null
  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) =>
            item.children ? (
              <CollapsibleNavItem key={item.title} item={item} />
            ) : (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild
                  tooltip={item.title}
                  isActive={item.isActive}
                >
                  <Link href={item.url}>
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

function CollapsibleNavItem({ item }: { item: NavItem }) {
  const [open, setOpen] = useState(true)

  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={item.title} isActive={item.isActive}>
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            <ChevronRight className={`ml-auto h-4 w-4 shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children!.map((child) => (
              <SidebarMenuSubItem key={child.title}>
                <SidebarMenuSubButton asChild isActive={child.isActive}>
                  <Link href={child.url}>
                    <span>{child.title}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}
