// d3-force-3d ships no types. Its API is d3-force's with a third axis (z, vz,
// fz on nodes, forceZ, and a dimension count on the simulation), so it reuses
// @types/d3-force.
declare module "d3-force-3d" {
  import type {
    ForceCollide,
    ForceLink,
    ForceManyBody,
    ForceX,
    ForceY,
    Simulation,
    SimulationLinkDatum,
    SimulationNodeDatum,
  } from "d3-force";

  export interface SimulationNodeDatum3D extends SimulationNodeDatum {
    z?: number | undefined;
    vz?: number | undefined;
    fz?: number | null | undefined;
  }
  export type { SimulationLinkDatum };

  export function forceSimulation<N extends SimulationNodeDatum3D>(
    nodes?: N[],
    numDimensions?: 1 | 2 | 3,
  ): Simulation<N, undefined>;
  export function forceLink<N extends SimulationNodeDatum3D, L extends SimulationLinkDatum<N>>(
    links?: L[],
  ): ForceLink<N, L>;
  export function forceManyBody<N extends SimulationNodeDatum3D>(): ForceManyBody<N>;
  export function forceCollide<N extends SimulationNodeDatum3D>(
    radius?: number | ((node: N, i: number, nodes: N[]) => number),
  ): ForceCollide<N>;
  export function forceX<N extends SimulationNodeDatum3D>(x?: number): ForceX<N>;
  export function forceY<N extends SimulationNodeDatum3D>(y?: number): ForceY<N>;
  /** forceX's shape, on the z axis. */
  export function forceZ<N extends SimulationNodeDatum3D>(z?: number): ForceX<N>;
}
