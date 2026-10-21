// Frontend of custom-reels: Reels made from the user's videos, track by track.
import { defineFrontendModule } from '@hub/sdk/frontend';
import { ReelsPage } from './ReelsPage';
import './custom-reels.css';

export default defineFrontendModule({
  pages: [{ path: '', component: ReelsPage }],
});
