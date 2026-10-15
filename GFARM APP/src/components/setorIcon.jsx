import {
  Layers,
  Fuel,
  Tractor,
  FlaskConical,
  Sprout,
  Droplets,
  Wrench,
  HardHat,
  Wheat,
  Package,
  Truck,
  Leaf,
} from 'lucide-react';
import { resolveSetorIcon } from '@/lib/setorIcon';

const ICON_MAP = {
  layers: Layers,
  fuel: Fuel,
  tractor: Tractor,
  flask: FlaskConical,
  fertilizer: Sprout,
  droplets: Droplets,
  wrench: Wrench,
  hardhat: HardHat,
  wheat: Wheat,
  package: Package,
  truck: Truck,
  leaf: Leaf,
};

export default function SetorIcon({ setor, icon, className }) {
  const name = icon || resolveSetorIcon(setor);
  const Comp = ICON_MAP[name] || Layers;
  return <Comp className={className} />;
}