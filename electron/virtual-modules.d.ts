declare module 'virtual:toolbox-modules' {
  import type { DiscoveredModule } from '../backend/core/hub';
  const modules: DiscoveredModule[];
  export default modules;
}
