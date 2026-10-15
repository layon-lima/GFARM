import TicketsManagerLegacy from './TicketsManagerLegacy';
import TicketsWorkspace from './TicketsWorkspace';

export default function TicketsManager(props) {
  if (props.mode && props.mode !== 'ativos') {
    return <TicketsManagerLegacy {...props} />;
  }

  return <TicketsWorkspace {...props} />;
}
