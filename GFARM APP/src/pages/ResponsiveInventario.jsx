import { useIsMobile } from '@/hooks/use-mobile';
import Inventario from '@/pages/Inventario';
import MobileInventario from '@/pages/mobile/MobileInventario';

export default function ResponsiveInventario() {
  return useIsMobile() ? <MobileInventario /> : <Inventario />;
}
