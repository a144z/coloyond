// @phosphor-icons/react ships declaration files that use extension-less
// relative subimports (written for bundler-style resolution), which tsc under
// NodeNext cannot follow. This ambient declaration replaces that broken graph
// for the handful of icons the mobile app uses. Props are deliberately loose:
// every icon renders as an SVG component with size/weight plus SVG attributes.
declare module '@phosphor-icons/react' {
  import type { ComponentType } from 'react';

  export interface IconProps {
    size?: number | string;
    weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
    title?: string;
    color?: string;
    [attribute: string]: unknown;
  }

  export const ArrowLeft: ComponentType<IconProps>;
  export const ArrowSquareOut: ComponentType<IconProps>;
  export const FadersHorizontal: ComponentType<IconProps>;
  export const GearSix: ComponentType<IconProps>;
  export const MagnifyingGlass: ComponentType<IconProps>;
  export const Wallet: ComponentType<IconProps>;
  export const X: ComponentType<IconProps>;
}
