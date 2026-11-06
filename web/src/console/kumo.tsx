"use client";

/**
 * Kumo compound components (`Table.Header`, `LayerCard.Primary`...) are client components: a server component
 * cannot dot into them. Server pages import these flat aliases instead.
 */
import { Breadcrumbs, LayerCard, Sidebar, Table } from "@cloudflare/kumo";

export const SidebarProvider = Sidebar.Provider;
export const KTable = Table;
export const KTableHeader = Table.Header;
export const KTableHead = Table.Head;
export const KTableBody = Table.Body;
export const KTableRow = Table.Row;
export const KTableCell = Table.Cell;
export const KLayerCard = LayerCard;
export const KLayerCardPrimary = LayerCard.Primary;
export const KLayerCardSecondary = LayerCard.Secondary;
export const KBreadcrumbs = Breadcrumbs;
export const KBreadcrumbsLink = Breadcrumbs.Link;
export const KBreadcrumbsSeparator = Breadcrumbs.Separator;
export const KBreadcrumbsCurrent = Breadcrumbs.Current;
