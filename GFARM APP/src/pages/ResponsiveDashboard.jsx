import Dashboard from '@/pages/Dashboard';
import MobileHome from '@/pages/mobile/MobileHome';
import { useIsMobile } from '@/hooks/use-mobile';

export default function ResponsiveDashboard() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileHome /> : <Dashboard />;
}
