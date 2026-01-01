// Type declarations for react-grid-layout v2
// The @types/react-grid-layout package is outdated and doesn't match the export structure

declare module "react-grid-layout" {
  import * as React from "react"

  export interface Layout {
    i: string
    x: number
    y: number
    w: number
    h: number
    minW?: number
    maxW?: number
    minH?: number
    maxH?: number
    moved?: boolean
    static?: boolean
    isDraggable?: boolean
    isResizable?: boolean
  }

  export interface Layouts {
    [breakpoint: string]: Layout[]
  }

  export interface ReactGridLayoutProps {
    className?: string
    style?: React.CSSProperties
    width: number
    autoSize?: boolean
    cols?: number
    draggableCancel?: string
    draggableHandle?: string
    verticalCompact?: boolean
    compactType?: "vertical" | "horizontal" | null
    layout?: Layout[]
    margin?: [number, number]
    containerPadding?: [number, number]
    rowHeight?: number
    maxRows?: number
    isDraggable?: boolean
    isResizable?: boolean
    isBounded?: boolean
    useCSSTransforms?: boolean
    transformScale?: number
    allowOverlap?: boolean
    preventCollision?: boolean
    isDroppable?: boolean
    onLayoutChange?: (layout: Layout[]) => void
    onDragStart?: (layout: Layout[], oldItem: Layout, newItem: Layout, placeholder: Layout, event: MouseEvent, element: HTMLElement) => void
    onDrag?: (layout: Layout[], oldItem: Layout, newItem: Layout, placeholder: Layout, event: MouseEvent, element: HTMLElement) => void
    onDragStop?: (layout: Layout[], oldItem: Layout, newItem: Layout, placeholder: Layout, event: MouseEvent, element: HTMLElement) => void
    onResizeStart?: (layout: Layout[], oldItem: Layout, newItem: Layout, placeholder: Layout, event: MouseEvent, element: HTMLElement) => void
    onResize?: (layout: Layout[], oldItem: Layout, newItem: Layout, placeholder: Layout, event: MouseEvent, element: HTMLElement) => void
    onResizeStop?: (layout: Layout[], oldItem: Layout, newItem: Layout, placeholder: Layout, event: MouseEvent, element: HTMLElement) => void
    onDrop?: (layout: Layout[], item: Layout, e: Event) => void
    children?: React.ReactNode
  }

  export interface ResponsiveProps extends Omit<ReactGridLayoutProps, "cols" | "layout" | "onLayoutChange"> {
    breakpoint?: string
    breakpoints?: { [breakpoint: string]: number }
    cols?: { [breakpoint: string]: number }
    layouts?: Layouts
    margin?: [number, number] | { [breakpoint: string]: [number, number] }
    containerPadding?: [number, number] | { [breakpoint: string]: [number, number] }
    onBreakpointChange?: (newBreakpoint: string, newCols: number) => void
    onLayoutChange?: (currentLayout: Layout[], allLayouts: Layouts) => void
    onWidthChange?: (containerWidth: number, margin: [number, number], cols: number, containerPadding: [number, number]) => void
  }

  // Components
  export const GridLayout: React.ComponentType<ReactGridLayoutProps>
  export const ReactGridLayout: React.ComponentType<ReactGridLayoutProps>
  export const ResponsiveGridLayout: React.ComponentType<ResponsiveProps>
  export const Responsive: React.ComponentType<ResponsiveProps>
  export const GridItem: React.ComponentType<any>

  // v2 useContainerWidth hook
  export interface UseContainerWidthOptions {
    /** Delays initial render until width is measured */
    measureBeforeMount?: boolean
    /** Initial width to use before measurement (default: 1280) */
    initialWidth?: number
  }

  export interface UseContainerWidthResult {
    /** Current container width in pixels */
    width: number
    /** Whether the container has been measured at least once */
    mounted: boolean
    /** Ref to attach to the container element */
    containerRef: React.RefObject<HTMLDivElement | null>
  }

  export function useContainerWidth(options?: UseContainerWidthOptions): UseContainerWidthResult

  // v2 useResponsiveLayout hook
  export interface UseResponsiveLayoutOptions<B extends string = string> {
    width: number
    layouts: { [key in B]?: Layout[] }
    breakpoints?: { [key in B]: number }
    cols?: { [key in B]: number }
    compactType?: "vertical" | "horizontal" | null
  }

  export interface UseResponsiveLayoutResult<B extends string = string> {
    layout: Layout[]
    breakpoint: B
    cols: number
  }

  export function useResponsiveLayout<B extends string = string>(
    options: UseResponsiveLayoutOptions<B>
  ): UseResponsiveLayoutResult<B>

  export function useGridLayout(props: any): any

  // Constants
  export const DEFAULT_BREAKPOINTS: { [breakpoint: string]: number }
  export const DEFAULT_COLS: { [breakpoint: string]: number }

  // Default export
  const ReactGridLayoutDefault: React.ComponentType<ReactGridLayoutProps>
  export default ReactGridLayoutDefault
}
