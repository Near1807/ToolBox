// Frontend of release-planner: calendar, today, Google account; home widget.
import { defineFrontendModule } from '@hub/sdk/frontend';
import { HomeWidget } from './HomeWidget';
import { PlannerPage } from './PlannerPage';
import './planner.css';

export default defineFrontendModule({
  pages: [{ path: '', component: PlannerPage }],
  nav: { label: 'Planning de sortie' },
  HomeWidget,
});
